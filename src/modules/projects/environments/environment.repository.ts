import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
import { EnvironmentType, type ProjectEnvironmentConfig } from "./environment.types.js";

const ENV_COLUMNS = `
  id, project_id, organization_id, name, slug, type, description, color,
  is_default, is_active, created_at, updated_at, deleted_at
`;

export type EnvRow = {
  id: string;
  project_id: string;
  organization_id: string;
  name: string;
  slug: string;
  type: EnvironmentType;
  description: string | null;
  color: string;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

type EnvironmentWrite = {
  name?: string | undefined;
  slug?: string | undefined;
  type?: EnvironmentType | undefined;
  description?: string | null | undefined;
  color?: string | undefined;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
};

export class EnvironmentRepository {
  constructor(private readonly db: Pool = pool) {}

  private async transaction<T>(
    client: PoolClient | undefined,
    work: (tx: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (client) return work(client);
    const tx = await this.db.connect();
    try {
      await tx.query("BEGIN");
      const result = await work(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }

  private translateConflict(error: unknown): never {
    if ((error as { code?: string }).code === "23505") {
      throw new ProjectError(
        "ENVIRONMENT_EXISTS",
        "An active environment with this slug already exists in the project",
        409,
      );
    }
    throw error;
  }

  async listEnvironments(
    projectId: string,
    includeDeleted = false,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig[]> {
    const db = client ?? this.db;
    const result = await db.query<EnvRow>(
      `SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 ${includeDeleted ? "" : "AND deleted_at IS NULL"}
        ORDER BY deleted_at NULLS FIRST, is_default DESC, name ASC`,
      [projectId],
    );
    return result.rows.map((row) => this.mapEnv(row));
  }

  async findEnvironment(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig | null> {
    const db = client ?? this.db;
    const result = await db.query<EnvRow>(
      `SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
      [projectId, environmentId],
    );
    return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
  }

  async findEnvironmentIncludingDeleted(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
    forUpdate = false,
  ): Promise<ProjectEnvironmentConfig | null> {
    const db = client ?? this.db;
    const result = await db.query<EnvRow>(
      `SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND id = $2 LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [projectId, environmentId],
    );
    return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
  }

  async createEnvironment(
    input: EnvironmentWrite & { projectId: string; orgId: string; name: string; slug: string; type: EnvironmentType; color: string },
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    try {
      return await this.transaction(client, async (tx) => {
        if (input.isDefault) {
          await tx.query(
            `UPDATE project_environments SET is_default = FALSE
              WHERE project_id = $1 AND is_default AND deleted_at IS NULL`,
            [input.projectId],
          );
        }
        const result = await tx.query<EnvRow>(
          `INSERT INTO project_environments (
             project_id, organization_id, name, slug, type, description, color, is_default, is_active
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,FALSE),COALESCE($9,TRUE))
           RETURNING ${ENV_COLUMNS}`,
          [input.projectId, input.orgId, input.name, input.slug, input.type,
           input.description ?? null, input.color, input.isDefault ?? null, input.isActive ?? null],
        );
        return this.mapEnv(result.rows[0]!);
      });
    } catch (error) {
      return this.translateConflict(error);
    }
  }

  async updateEnvironment(
    projectId: string,
    environmentId: string,
    input: EnvironmentWrite,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    try {
      return await this.transaction(client, async (tx) => {
        const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
        if (!current || current.deletedAt) {
          throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
        }
        if (current.isDefault && input.isDefault === false) {
          throw new ProjectError(
            "DEFAULT_ENVIRONMENT_REQUIRED",
            "Set another environment as default before removing the current default",
            409,
          );
        }

        const nextActive = input.isActive ?? current.isActive;
        if (!nextActive && current.isActive) {
          await this.assertCanDeactivate(tx, projectId, current);
        }
        if (input.isDefault === true) {
          if (!nextActive) {
            throw new ProjectError("DEFAULT_ENVIRONMENT_INACTIVE", "The default environment must be active", 409);
          }
          await tx.query(
            `UPDATE project_environments SET is_default = FALSE
              WHERE project_id = $1 AND id <> $2 AND is_default AND deleted_at IS NULL`,
            [projectId, environmentId],
          );
        }

        const assignments: string[] = [];
        const values: unknown[] = [];
        const set = (column: string, value: unknown) => {
          values.push(value);
          assignments.push(`${column} = $${values.length}`);
        };
        if (input.name !== undefined) set("name", input.name);
        if (input.slug !== undefined) set("slug", input.slug);
        if (input.type !== undefined) set("type", input.type);
        if (input.description !== undefined) set("description", input.description);
        if (input.color !== undefined) set("color", input.color);
        if (input.isActive !== undefined) set("is_active", input.isActive);
        if (input.isDefault !== undefined) set("is_default", input.isDefault);
        if (assignments.length === 0) return current;

        values.push(projectId, environmentId);
        const result = await tx.query<EnvRow>(
          `UPDATE project_environments SET ${assignments.join(", ")}
            WHERE project_id = $${values.length - 1} AND id = $${values.length} AND deleted_at IS NULL
            RETURNING ${ENV_COLUMNS}`,
          values,
        );
        return this.mapEnv(result.rows[0]!);
      });
    } catch (error) {
      return this.translateConflict(error);
    }
  }

  private async assertCanDeactivate(
    tx: PoolClient,
    projectId: string,
    environment: ProjectEnvironmentConfig,
  ): Promise<void> {
    const active = await tx.query<{ id: string }>(
      `SELECT id FROM project_environments
        WHERE project_id = $1 AND is_active AND deleted_at IS NULL
        FOR UPDATE`,
      [projectId],
    );
    if ((active.rowCount ?? 0) <= 1) {
      throw new ProjectError(
        "LAST_ACTIVE_ENVIRONMENT",
        "The last active environment cannot be deactivated or deleted",
        409,
      );
    }
    if (environment.isDefault) {
      const replacement = await tx.query(
        `SELECT 1 FROM project_environments
          WHERE project_id = $1 AND id <> $2 AND is_default AND is_active AND deleted_at IS NULL LIMIT 1`,
        [projectId, environment.id],
      );
      if (replacement.rowCount === 0) {
        throw new ProjectError(
          "DEFAULT_ENVIRONMENT_REQUIRED",
          "Set another active environment as default first",
          409,
        );
      }
    }
  }

  async setDefaultEnvironment(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    return this.updateEnvironment(projectId, environmentId, { isDefault: true, isActive: true }, client);
  }

  async deactivateEnvironment(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    return this.updateEnvironment(projectId, environmentId, { isActive: false }, client);
  }

  async deleteEnvironment(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
  ): Promise<void> {
    await this.transaction(client, async (tx) => {
      const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
      if (!current || current.deletedAt) {
        throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
      }
      if (current.isActive) await this.assertCanDeactivate(tx, projectId, current);
      await tx.query(
        `UPDATE project_environments
            SET deleted_at = NOW(), is_active = FALSE, is_default = FALSE
          WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [projectId, environmentId],
      );
    });
  }

  async restoreEnvironment(
    projectId: string,
    environmentId: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    try {
      return await this.transaction(client, async (tx) => {
        const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
        if (!current || !current.deletedAt) {
          throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Deleted environment not found", 404);
        }
        const result = await tx.query<EnvRow>(
          `UPDATE project_environments
              SET deleted_at = NULL, is_active = TRUE, is_default = FALSE
            WHERE project_id = $1 AND id = $2 AND deleted_at IS NOT NULL
            RETURNING ${ENV_COLUMNS}`,
          [projectId, environmentId],
        );
        return this.mapEnv(result.rows[0]!);
      });
    } catch (error) {
      return this.translateConflict(error);
    }
  }

  public mapEnv(row: EnvRow): ProjectEnvironmentConfig {
    return {
      id: row.id,
      projectId: row.project_id,
      orgId: row.organization_id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      description: row.description,
      color: row.color,
      isDefault: row.is_default,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
}