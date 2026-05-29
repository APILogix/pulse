/**
 * Project repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and query options.
 * 2. Execute parameterized SQL against projects, project_api_keys, and
 *    organization membership tables.
 * 3. Map snake_case database rows into camelCase domain objects.
 * 4. Translate expected database conflicts/misses into ProjectError where the
 *    service needs a stable error code.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type {
  ListApiKeysQuery,
  ListProjectsQuery,
  OrganizationMembership,
  OrgRole,
  Project,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectEnvironment,
  ProjectListItem,
  ProjectStatus,
} from "./types.js";
import { ProjectError } from "./utils.js";

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  environment: ProjectEnvironment;
  production_api_prefix: string | null;
  development_api_prefix: string | null;
  created_at: Date;
  updated_at: Date;
  api_keys_count?: string | number;
  active_api_keys_count?: string | number;
};

type ApiKeyRow = {
  id: string;
  project_id: string;
  key_hash: string;
  key_prefix: string;
  environment: ProjectEnvironment;
  name: string | null;
  is_active: boolean;
  created_by: string | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
};

type ApiKeyCandidateRow = {
  api_key_id: string;
  project_id: string;
  key_hash: string;
  key_prefix: string;
  key_environment: ProjectEnvironment;
  key_name: string | null;
  is_active: boolean;
  created_by: string | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  api_key_created_at: Date;
  org_id: string;
  project_name: string;
  project_slug: string;
  project_description: string | null;
  project_status: ProjectStatus;
  project_environment: ProjectEnvironment;
  production_api_prefix: string | null;
  development_api_prefix: string | null;
  project_created_at: Date;
  project_updated_at: Date;
};

type MembershipRow = {
  org_id: string;
  user_id: string;
  role: OrgRole;
  is_active: boolean;
};

export class ProjectsRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    // Used by service operations such as API-key rotation where multiple writes
    // must commit or roll back as one unit.
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findOrganizationMembership(
    orgId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<OrganizationMembership | null> {
    const db = client ?? this.db;
    // NOTE: organization_members has a `status member_status` column, NOT an
    // `is_active` boolean. We derive isActive from status = 'active'.
    const result = await db.query<MembershipRow>(
      `SELECT org_id, user_id, role, (status = 'active') AS is_active
       FROM organization_members
       WHERE org_id = $1 AND user_id = $2
       LIMIT 1`,
      [orgId, userId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      orgId: row.org_id,
      userId: row.user_id,
      role: row.role,
      isActive: row.is_active,
    };
  }

  async listProjects(
    orgId: string,
    query: ListProjectsQuery,
    client?: PoolClient,
  ): Promise<{ projects: ProjectListItem[]; total: number }> {
    // Build filters from validated query params. Column names used for sorting
    // come from a fixed map, not user-provided strings.
    const db = client ?? this.db;
    const params: Array<string | number> = [orgId];
    const whereClauses = ["p.org_id = $1"];

    if (query.status) {
      params.push(query.status);
      whereClauses.push(`p.status = $${params.length}`);
    }

    if (query.environment) {
      params.push(query.environment);
      whereClauses.push(`p.environment = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      whereClauses.push(
        `(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length})`,
      );
    }

    const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM projects p
       ${whereClause}`,
      params,
    );

    const sortColumnMap = {
      created_at: "p.created_at",
      updated_at: "p.updated_at",
      name: "p.name",
    } as const;
    const sortColumn = sortColumnMap[query.sortBy];
    const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const offset =
      query.offset ?? ((query.page ?? 1) - 1) * query.limit;

    params.push(query.limit, offset);
    const result = await db.query<ProjectRow>(
      `SELECT
         p.*,
         COUNT(k.id)::int AS api_keys_count,
         COUNT(k.id) FILTER (WHERE k.is_active = TRUE)::int AS active_api_keys_count
       FROM projects p
       LEFT JOIN project_api_keys k ON k.project_id = p.id
       ${whereClause}
       GROUP BY p.id
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return {
      projects: result.rows.map((row) => this.mapProjectWithCounts(row)),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
    };
  }

  async createProject(
    input: {
      orgId: string;
      name: string;
      slug: string;
      description: string | null;
      environment: ProjectEnvironment;
      productionApiPrefix: string | null;
      developmentApiPrefix: string | null;
    },
    client?: PoolClient,
  ): Promise<Project> {
    const db = client ?? this.db;
    try {
      const result = await db.query<ProjectRow>(
        `INSERT INTO projects (
          org_id,
          name,
          slug,
          description,
          environment,
          production_api_prefix,
          development_api_prefix
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          input.orgId,
          input.name,
          input.slug,
          input.description,
          input.environment,
          input.productionApiPrefix,
          input.developmentApiPrefix,
        ],
      );

      return this.mapProject(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ProjectError(
          "PROJECT_SLUG_EXISTS",
          "A project with the same slug already exists in this organization",
          409,
        );
      }

      throw error;
    }
  }

  async findProjectBySlug(
    orgId: string,
    slug: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    const db = client ?? this.db;
    const result = await db.query<ProjectRow>(
      `SELECT *
       FROM projects
       WHERE org_id = $1 AND slug = $2
       LIMIT 1`,
      [orgId, slug],
    );

    return result.rows[0] ? this.mapProject(result.rows[0]) : null;
  }

  async findProjectById(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    const db = client ?? this.db;
    const result = await db.query<ProjectRow>(
      `SELECT *
       FROM projects
       WHERE org_id = $1 AND id = $2
       LIMIT 1`,
      [orgId, projectId],
    );

    return result.rows[0] ? this.mapProject(result.rows[0]) : null;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    input: {
      name?: string;
      description?: string | null;
      status?: ProjectStatus;
      environment?: ProjectEnvironment;
      productionApiPrefix?: string | null;
      developmentApiPrefix?: string | null;
    },
    client?: PoolClient,
  ): Promise<Project> {
    // Dynamic assignment keeps PATCH semantics: only explicitly supplied fields
    // are written, and an empty update returns the current record.
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: Array<string | null> = [];
    let index = 1;

    if (input.name !== undefined) {
      assignments.push(`name = $${index++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      assignments.push(`description = $${index++}`);
      values.push(input.description);
    }
    if (input.status !== undefined) {
      assignments.push(`status = $${index++}`);
      values.push(input.status);
    }
    if (input.environment !== undefined) {
      assignments.push(`environment = $${index++}`);
      values.push(input.environment);
    }
    if (input.productionApiPrefix !== undefined) {
      assignments.push(`production_api_prefix = $${index++}`);
      values.push(input.productionApiPrefix);
    }
    if (input.developmentApiPrefix !== undefined) {
      assignments.push(`development_api_prefix = $${index++}`);
      values.push(input.developmentApiPrefix);
    }

    if (assignments.length === 0) {
      const project = await this.findProjectById(orgId, projectId, client);
      if (!project) {
        throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
      }
      return project;
    }

    values.push(orgId, projectId);
    const result = await db.query<ProjectRow>(
      `UPDATE projects
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE org_id = $${index++} AND id = $${index}
       RETURNING *`,
      values,
    );

    if (result.rowCount === 0) {
      throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
    }

    return this.mapProject(result.rows[0]!);
  }

  async deleteProject(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `DELETE FROM projects
       WHERE org_id = $1 AND id = $2`,
      [orgId, projectId],
    );

    if (result.rowCount === 0) {
      throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
    }
  }

  async getProjectStats(
    projectId: string,
    client?: PoolClient,
  ): Promise<{ apiKeysCount: number; activeKeysCount: number }> {
    const db = client ?? this.db;
    const result = await db.query<{
      api_keys_count: string;
      active_keys_count: string;
    }>(
      `SELECT
         COUNT(*)::text AS api_keys_count,
         COUNT(*) FILTER (WHERE is_active = TRUE)::text AS active_keys_count
       FROM project_api_keys
       WHERE project_id = $1`,
      [projectId],
    );

    return {
      apiKeysCount: Number.parseInt(result.rows[0]?.api_keys_count ?? "0", 10),
      activeKeysCount: Number.parseInt(
        result.rows[0]?.active_keys_count ?? "0",
        10,
      ),
    };
  }

  async listApiKeys(
    projectId: string,
    query: ListApiKeysQuery,
    client?: PoolClient,
  ): Promise<{ keys: ProjectApiKey[]; total: number }> {
    // API-key list responses never include key hashes; those stay available only
    // through internal record queries.
    const db = client ?? this.db;
    const params: Array<string | number | boolean> = [projectId];
    const whereClauses = ["project_id = $1"];

    if (query.environment) {
      params.push(query.environment);
      whereClauses.push(`environment = $${params.length}`);
    }

    if (query.isActive !== undefined) {
      params.push(query.isActive);
      whereClauses.push(`is_active = $${params.length}`);
    } else if (query.includeInactive === false) {
      whereClauses.push("is_active = TRUE");
    }

    const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM project_api_keys
       ${whereClause}`,
      params,
    );

    const offset =
      query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    params.push(query.limit, offset);

    const result = await db.query<ApiKeyRow>(
      `SELECT *
       FROM project_api_keys
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return {
      keys: result.rows.map((row) => this.mapApiKey(row)),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
    };
  }

  async createApiKey(
    input: {
      projectId: string;
      keyHash: string;
      keyPrefix: string;
      environment: ProjectEnvironment;
      name: string | null;
      createdBy: string;
      expiresAt: Date | null;
    },
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord> {
    // Persist keyHash for verification and keyPrefix for candidate narrowing.
    // The full API key is never stored.
    const db = client ?? this.db;
    try {
      const result = await db.query<ApiKeyRow>(
        `INSERT INTO project_api_keys (
          project_id,
          key_hash,
          key_prefix,
          environment,
          name,
          created_by,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          input.projectId,
          input.keyHash,
          input.keyPrefix,
          input.environment,
          input.name,
          input.createdBy,
          input.expiresAt,
        ],
      );

      
      return this.mapApiKeyRecord(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ProjectError(
          "API_KEY_CONFLICT",
          "Failed to create a unique API key. Please try again.",
          409,
        );
      }

      throw error;
    }
  }

  async countActiveApiKeys(
    projectId: string,
    environment: ProjectEnvironment,
    client?: PoolClient,
  ): Promise<number> {
    const db = client ?? this.db;
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM project_api_keys
       WHERE project_id = $1
         AND environment = $2
         AND is_active = TRUE`,
      [projectId, environment],
    );

    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async findApiKeyById(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<ProjectApiKey | null> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `SELECT *
       FROM project_api_keys
       WHERE project_id = $1 AND id = $2
       LIMIT 1`,
      [projectId, apiKeyId],
    );

    return result.rows[0] ? this.mapApiKey(result.rows[0]) : null;
  }

  async findApiKeyRecordById(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord | null> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `SELECT *
       FROM project_api_keys
       WHERE project_id = $1 AND id = $2
       LIMIT 1`,
      [projectId, apiKeyId],
    );

    return result.rows[0] ? this.mapApiKeyRecord(result.rows[0]) : null;
  }

  async updateApiKey(
    projectId: string,
    apiKeyId: string,
    input: {
      name?: string | null;
      expiresAt?: Date | null;
    },
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: Array<string | Date | null> = [];
    let index = 1;

    if (input.name !== undefined) {
      assignments.push(`name = $${index++}`);
      values.push(input.name);
    }
    if (input.expiresAt !== undefined) {
      assignments.push(`expires_at = $${index++}`);
      values.push(input.expiresAt);
    }

    if (assignments.length === 0) {
      const apiKey = await this.findApiKeyById(projectId, apiKeyId, client);
      if (!apiKey) {
        throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
      }
      return apiKey;
    }

    values.push(projectId, apiKeyId);
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
       SET ${assignments.join(", ")}
       WHERE project_id = $${index++} AND id = $${index}
       RETURNING *`,
      values,
    );

    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }

    return this.mapApiKey(result.rows[0]!);
  }

  async setApiKeyActiveState(
    projectId: string,
    apiKeyId: string,
    isActive: boolean,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
       SET is_active = $3
       WHERE project_id = $1 AND id = $2
       RETURNING *`,
      [projectId, apiKeyId, isActive],
    );

    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }

    return this.mapApiKey(result.rows[0]!);
  }

  async deleteApiKey(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `DELETE FROM project_api_keys
       WHERE project_id = $1 AND id = $2`,
      [projectId, apiKeyId],
    );

    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
  }

  async touchApiKeyLastUsed(
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `UPDATE project_api_keys
       SET last_used_at = NOW()
       WHERE id = $1`,
      [apiKeyId],
    );
  }

  /**
   * Return the key hashes for every API key of a project. Used by the service
   * to evict the in-process ingestion cache when a project is paused, archived,
   * or deleted so stale keys stop resolving as active.
   */
  async listApiKeyHashesByProject(
    projectId: string,
    client?: PoolClient,
  ): Promise<string[]> {
    const db = client ?? this.db;
    const result = await db.query<{ key_hash: string }>(
      `SELECT key_hash FROM project_api_keys WHERE project_id = $1`,
      [projectId],
    );
    return result.rows.map((row) => row.key_hash);
  }

  async findActiveApiKeyCandidatesByPrefix(
    keyPrefix: string,
    client?: PoolClient,
  ): Promise<
    Array<{
      apiKey: ProjectApiKeyRecord;
      project: Project;
    }>
  > {
    // The prefix lookup limits candidate keys before the service performs
    // constant-time comparison against the full hash.
    const db = client ?? this.db;
    const result = await db.query<ApiKeyCandidateRow>(
      `SELECT
         k.id AS api_key_id,
         k.project_id,
         k.key_hash,
         k.key_prefix,
         k.environment AS key_environment,
         k.name AS key_name,
         k.is_active,
         k.created_by,
         k.last_used_at,
         k.expires_at,
         k.created_at AS api_key_created_at,
         p.org_id,
         p.name AS project_name,
         p.slug AS project_slug,
         p.description AS project_description,
         p.status AS project_status,
         p.environment AS project_environment,
         p.production_api_prefix,
         p.development_api_prefix,
         p.created_at AS project_created_at,
         p.updated_at AS project_updated_at
       FROM project_api_keys k
       INNER JOIN projects p ON p.id = k.project_id
       WHERE k.key_prefix = $1
         AND k.is_active = TRUE
         AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [keyPrefix],
    );

    return result.rows.map((row) => ({
      apiKey: {
        id: row.api_key_id,
        projectId: row.project_id,
        keyHash: row.key_hash,
        keyPrefix: row.key_prefix,
        environment: row.key_environment,
        name: row.key_name,
        isActive: row.is_active,
        createdBy: row.created_by,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        createdAt: row.api_key_created_at,
      },
      project: {
        id: row.project_id,
        orgId: row.org_id,
        name: row.project_name,
        slug: row.project_slug,
        description: row.project_description,
        status: row.project_status,
        environment: row.project_environment,
        productionApiPrefix: row.production_api_prefix,
        developmentApiPrefix: row.development_api_prefix,
        createdAt: row.project_created_at,
        updatedAt: row.project_updated_at,
      },
    }));
  }

  private mapProject(row: ProjectRow): Project {
    // Keep database naming isolated in the repository so services and routes use
    // stable camelCase module types.
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      environment: row.environment,
      productionApiPrefix: row.production_api_prefix,
      developmentApiPrefix: row.development_api_prefix,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapProjectWithCounts(row: ProjectRow): ProjectListItem {
    return {
      ...this.mapProject(row),
      apiKeysCount: Number(row.api_keys_count ?? 0),
      activeApiKeysCount: Number(row.active_api_keys_count ?? 0),
    };
  }

  private mapApiKey(row: ApiKeyRow): ProjectApiKey {
    return {
      id: row.id,
      projectId: row.project_id,
      keyPrefix: row.key_prefix,
      environment: row.environment,
      name: row.name,
      isActive: row.is_active,
      createdBy: row.created_by,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord {
    return {
      ...this.mapApiKey(row),
      keyHash: row.key_hash,
    };
  }
}
