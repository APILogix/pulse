import { pool } from "../../../config/database.js";
import { ProjectError } from "../shared/utils.js";
import { EnvironmentType } from "./environment.types.js";
const ENV_COLUMNS = `
  id, project_id, organization_id, name, slug, type, description, color,
  is_default, is_active, created_at, updated_at, deleted_at
`;
export class EnvironmentRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async transaction(client, work) {
        if (client)
            return work(client);
        const tx = await this.db.connect();
        try {
            await tx.query("BEGIN");
            const result = await work(tx);
            await tx.query("COMMIT");
            return result;
        }
        catch (error) {
            await tx.query("ROLLBACK");
            throw error;
        }
        finally {
            tx.release();
        }
    }
    translateConflict(error) {
        if (error.code === "23505") {
            throw new ProjectError("ENVIRONMENT_EXISTS", "An active environment with this slug already exists in the project", 409);
        }
        throw error;
    }
    async listEnvironments(projectId, includeDeleted = false, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 ${includeDeleted ? "" : "AND deleted_at IS NULL"}
        ORDER BY deleted_at NULLS FIRST, is_default DESC, name ASC`, [projectId]);
        return result.rows.map((row) => this.mapEnv(row));
    }
    async findEnvironment(projectId, environmentId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`, [projectId, environmentId]);
        return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
    }
    async findEnvironmentIncludingDeleted(projectId, environmentId, client, forUpdate = false) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND id = $2 LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`, [projectId, environmentId]);
        return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
    }
    async createEnvironment(input, client) {
        try {
            return await this.transaction(client, async (tx) => {
                if (input.isDefault) {
                    await tx.query(`UPDATE project_environments SET is_default = FALSE
              WHERE project_id = $1 AND is_default AND deleted_at IS NULL`, [input.projectId]);
                }
                const result = await tx.query(`INSERT INTO project_environments (
             project_id, organization_id, name, slug, type, description, color, is_default, is_active
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,FALSE),COALESCE($9,TRUE))
           RETURNING ${ENV_COLUMNS}`, [input.projectId, input.orgId, input.name, input.slug, input.type,
                    input.description ?? null, input.color, input.isDefault ?? null, input.isActive ?? null]);
                return this.mapEnv(result.rows[0]);
            });
        }
        catch (error) {
            return this.translateConflict(error);
        }
    }
    async updateEnvironment(projectId, environmentId, input, client) {
        try {
            return await this.transaction(client, async (tx) => {
                const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
                if (!current || current.deletedAt) {
                    throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
                }
                if (current.isDefault && input.isDefault === false) {
                    throw new ProjectError("DEFAULT_ENVIRONMENT_REQUIRED", "Set another environment as default before removing the current default", 409);
                }
                const nextActive = input.isActive ?? current.isActive;
                if (!nextActive && current.isActive) {
                    await this.assertCanDeactivate(tx, projectId, current);
                }
                if (input.isDefault === true) {
                    if (!nextActive) {
                        throw new ProjectError("DEFAULT_ENVIRONMENT_INACTIVE", "The default environment must be active", 409);
                    }
                    await tx.query(`UPDATE project_environments SET is_default = FALSE
              WHERE project_id = $1 AND id <> $2 AND is_default AND deleted_at IS NULL`, [projectId, environmentId]);
                }
                const assignments = [];
                const values = [];
                const set = (column, value) => {
                    values.push(value);
                    assignments.push(`${column} = $${values.length}`);
                };
                if (input.name !== undefined)
                    set("name", input.name);
                if (input.slug !== undefined)
                    set("slug", input.slug);
                if (input.type !== undefined)
                    set("type", input.type);
                if (input.description !== undefined)
                    set("description", input.description);
                if (input.color !== undefined)
                    set("color", input.color);
                if (input.isActive !== undefined)
                    set("is_active", input.isActive);
                if (input.isDefault !== undefined)
                    set("is_default", input.isDefault);
                if (assignments.length === 0)
                    return current;
                values.push(projectId, environmentId);
                const result = await tx.query(`UPDATE project_environments SET ${assignments.join(", ")}
            WHERE project_id = $${values.length - 1} AND id = $${values.length} AND deleted_at IS NULL
            RETURNING ${ENV_COLUMNS}`, values);
                return this.mapEnv(result.rows[0]);
            });
        }
        catch (error) {
            return this.translateConflict(error);
        }
    }
    async assertCanDeactivate(tx, projectId, environment) {
        const active = await tx.query(`SELECT id FROM project_environments
        WHERE project_id = $1 AND is_active AND deleted_at IS NULL
        FOR UPDATE`, [projectId]);
        if ((active.rowCount ?? 0) <= 1) {
            throw new ProjectError("LAST_ACTIVE_ENVIRONMENT", "The last active environment cannot be deactivated or deleted", 409);
        }
        if (environment.isDefault) {
            const replacement = await tx.query(`SELECT 1 FROM project_environments
          WHERE project_id = $1 AND id <> $2 AND is_default AND is_active AND deleted_at IS NULL LIMIT 1`, [projectId, environment.id]);
            if (replacement.rowCount === 0) {
                throw new ProjectError("DEFAULT_ENVIRONMENT_REQUIRED", "Set another active environment as default first", 409);
            }
        }
    }
    async setDefaultEnvironment(projectId, environmentId, client) {
        return this.updateEnvironment(projectId, environmentId, { isDefault: true, isActive: true }, client);
    }
    async deactivateEnvironment(projectId, environmentId, client) {
        return this.updateEnvironment(projectId, environmentId, { isActive: false }, client);
    }
    async deleteEnvironment(projectId, environmentId, client) {
        await this.transaction(client, async (tx) => {
            const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
            if (!current || current.deletedAt) {
                throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
            }
            if (current.isActive)
                await this.assertCanDeactivate(tx, projectId, current);
            await tx.query(`UPDATE project_environments
            SET deleted_at = NOW(), is_active = FALSE, is_default = FALSE
          WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`, [projectId, environmentId]);
        });
    }
    async restoreEnvironment(projectId, environmentId, client) {
        try {
            return await this.transaction(client, async (tx) => {
                const current = await this.findEnvironmentIncludingDeleted(projectId, environmentId, tx, true);
                if (!current || !current.deletedAt) {
                    throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Deleted environment not found", 404);
                }
                const result = await tx.query(`UPDATE project_environments
              SET deleted_at = NULL, is_active = TRUE, is_default = FALSE
            WHERE project_id = $1 AND id = $2 AND deleted_at IS NOT NULL
            RETURNING ${ENV_COLUMNS}`, [projectId, environmentId]);
                return this.mapEnv(result.rows[0]);
            });
        }
        catch (error) {
            return this.translateConflict(error);
        }
    }
    mapEnv(row) {
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
//# sourceMappingURL=environment.repository.js.map