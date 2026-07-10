/**
 * Project repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Execute parameterized SQL against projects, project_environments,
 *    project_api_keys, project_api_key_usage, and organization membership.
 * 3. Map snake_case rows into camelCase domain objects.
 * 4. Translate expected DB conflicts/misses into ProjectError with stable codes.
 *
 * Tenant isolation: every project/key query is scoped by org_id (and
 * project_id) so a caller can never read or mutate another org's data.
 * Soft delete: projects set deleted_at; all reads filter deleted_at IS NULL.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type {
  ApiKeyStatus,
  ApiKeyType,
  ListApiKeysQuery,
  ListProjectActivityQuery,
  ListProjectsQuery,
  OrganizationMembership,
  OrgRole,
  Project,
  ProjectActivityResult,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectEnvironment,
  ProjectEnvironmentConfig,
  ProjectListItem,
  ProjectStatus,
  ProjectUsageCounter,
  ProjectUpdateInput,
} from "../types.js";
import { ProjectError } from "../shared/utils.js";

// Column list selected for every project read. Centralized so the projection
// stays consistent across find/list/update.
const PROJECT_COLUMNS = `
  id, org_id, name, slug, description, status, default_environment AS environment,
  archived_at, deleted_at, created_at, updated_at
`;

const API_KEY_COLUMNS = `
  id, project_id, org_id, key_hash, key_prefix, key_type, environment,
  name, description, is_active, status, created_by,
  rotated_from_key_id, rotated_at, rotated_by, rotation_reason, grace_period_ends_at,
  revoked_at, revoked_by, revoked_reason, expires_at,
  auto_rotate_enabled, auto_rotate_days,
  last_used_at, last_used_ip, usage_count, error_count,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
  permissions, allowed_endpoints, blocked_endpoints, metadata,
  created_at, updated_at
`;

const ENV_COLUMNS = `
  id, project_id, org_id, environment, is_active,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
  allowed_event_types, max_event_size_bytes, max_batch_size,
  require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
  created_by, created_at, updated_at
`;

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
  staging_api_prefix: string | null;
  rate_limit_per_second: number;
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  burst_limit: number;
  allowed_event_types: string[] | null;
  max_event_size_bytes: number;
  max_batch_size: number;
  allowed_origins: string[] | null;
  require_https: boolean;
  ip_allowlist: string[] | null;
  ip_blocklist: string[] | null;
  geo_restriction_enabled: boolean;
  allowed_countries: string[] | null;
  alert_email: string | null;
  alert_webhook_url: string | null;
  alert_on_error_rate_threshold: string | number;
  alert_on_latency_threshold_ms: number;
  metadata: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
  api_keys_count?: string | number;
  active_api_keys_count?: string | number;
};

type ApiKeyRow = {
  id: string;
  project_id: string;
  org_id: string | null;
  key_hash: string;
  key_prefix: string;
  key_type: ApiKeyType;
  environment: ProjectEnvironment;
  name: string | null;
  description: string | null;
  is_active: boolean;
  status: ApiKeyStatus;
  created_by: string | null;
  rotated_from_key_id: string | null;
  rotated_at: Date | null;
  rotated_by: string | null;
  rotation_reason: string | null;
  grace_period_ends_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  expires_at: Date | null;
  auto_rotate_enabled: boolean;
  auto_rotate_days: number;
  last_used_at: Date | null;
  last_used_ip: string | null;
  usage_count: string | number;
  error_count: string | number;
  rate_limit_per_second: number | null;
  rate_limit_per_minute: number | null;
  rate_limit_per_hour: number | null;
  permissions: string[] | null;
  allowed_endpoints: string[] | null;
  blocked_endpoints: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type EnvRow = {
  id: string;
  project_id: string;
  org_id: string;
  environment: ProjectEnvironment;
  is_active: boolean;
  rate_limit_per_second: number | null;
  rate_limit_per_minute: number | null;
  rate_limit_per_hour: number | null;
  burst_limit: number | null;
  allowed_event_types: string[] | null;
  max_event_size_bytes: number | null;
  max_batch_size: number | null;
  require_https: boolean;
  ip_allowlist: string[] | null;
  ip_blocklist: string[] | null;
  alert_email: string | null;
  alert_webhook_url: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type MembershipRow = {
  org_id: string;
  user_id: string;
  role: OrgRole;
  is_active: boolean;
};

type ProjectActivityRow = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  changed_fields: string[] | null;
  status: string;
  is_sensitive: boolean;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

// Field sets accepted by the dynamic project/key writers. Each maps a domain
// field to its column + value, so PATCH semantics only touch supplied fields.




export interface ProjectModuleUsageCounts {
  projects: number;
  environments: number;
  apiKeys: number;
}

const DEFAULT_PROJECT_ENVIRONMENTS: ProjectEnvironment[] = ["development", "staging", "production"];

export class ProjectRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
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

  // ── Membership ────────────────────────────────────────────────────────────
  // ── Projects ────────────────────────────────────────────────────────────────

  async listProjects(
    orgId: string,
    query: ListProjectsQuery,
    client?: PoolClient,
  ): Promise<{ projects: ProjectListItem[]; total: number }> {
    const db = client ?? this.db;
    const params: Array<string | number | boolean> = [orgId];
    const whereClauses = ["p.org_id = $1"];

    if (!query.includeDeleted) {
      whereClauses.push("p.deleted_at IS NULL");
    }
    if (query.status) {
      params.push(query.status);
      whereClauses.push(`p.status = $${params.length}`);
    }
    if (query.environment) {
      params.push(query.environment);
      whereClauses.push(`p.default_environment = ${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      whereClauses.push(
        `(p.name ILIKE $${params.length} OR p.slug ILIKE $${params.length})`,
      );
    }

    const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM projects p ${whereClause}`,
      params,
    );

    const sortColumnMap = {
      created_at: "p.created_at",
      updated_at: "p.updated_at",
      name: "p.name",
    } as const;
    const sortColumn = sortColumnMap[query.sortBy];
    const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;

    params.push(query.limit, offset);
    const result = await db.query<ProjectRow>(
      `SELECT
         ${PROJECT_COLUMNS.split(",").map((c) => `p.${c.trim()}`).join(", ")},
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
      stagingApiPrefix: string | null;
      config: ProjectUpdateInput;
    },
    client?: PoolClient,
  ): Promise<Project> {
    const db = client ?? this.db;
    try {
      const result = await db.query<ProjectRow>(
        `INSERT INTO projects (
           org_id, name, slug, description, default_environment
         ) VALUES (
           $1,$2,$3,$4,$5
         )
         RETURNING ${PROJECT_COLUMNS}`,
        [
          input.orgId,
          input.name,
          input.slug,
          input.description,
          input.environment,
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
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND slug = $2 AND deleted_at IS NULL
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
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [orgId, projectId],
    );
    return result.rows[0] ? this.mapProject(result.rows[0]) : null;
  }

  async findProjectByIdIncludingDeleted(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    const db = client ?? this.db;
    const result = await db.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS} FROM projects
        WHERE org_id = $1 AND id = $2
        LIMIT 1`,
      [orgId, projectId],
    );
    return result.rows[0] ? this.mapProject(result.rows[0]) : null;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    input: ProjectUpdateInput,
    client?: PoolClient,
  ): Promise<Project> {
    const db = client ?? this.db;
    const { assignments, values } = this.buildProjectAssignments(input);

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
          SET ${assignments.join(", ")}
        WHERE org_id = $${values.length - 1}
          AND id = $${values.length}
          AND deleted_at IS NULL
        RETURNING ${PROJECT_COLUMNS}`,
      values,
    );

    if (result.rowCount === 0) {
      throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
    }
    return this.mapProject(result.rows[0]!);
  }

  /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
  async softDeleteProject(
    orgId: string,
    projectId: string,
    deletedBy: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `UPDATE projects
          SET deleted_at = NOW(), deleted_by = $3, status = 'archived'
        WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [orgId, projectId, deletedBy],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
    }
  }

  async restoreProject(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project> {
    const db = client ?? this.db;
    const result = await db.query<ProjectRow>(
      `UPDATE projects
          SET deleted_at = NULL,
              deleted_by = NULL,
              archived_at = NULL,
              status = 'active'
        WHERE org_id = $1
          AND id = $2
          AND deleted_at IS NOT NULL
        RETURNING ${PROJECT_COLUMNS}`,
      [orgId, projectId],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("PROJECT_NOT_FOUND", "Deleted project not found", 404);
    }
    return this.mapProject(result.rows[0]!);
  }

  // ── Mapping helpers ─────────────────────────────────────────────────────────

  private buildProjectAssignments(input: ProjectUpdateInput): {
    assignments: string[];
    values: unknown[];
  } {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      assignments.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (input.name !== undefined) set("name", input.name);
    if (input.description !== undefined) set("description", input.description);
    if (input.status !== undefined) set("status", input.status);
    if (input.environment !== undefined) set("default_environment", input.environment);
    if (input.archivedAt !== undefined) set("archived_at", input.archivedAt);

    return { assignments, values };
  }


  /** Build a ProjectRow from the p_*-prefixed columns of the candidate join. */
  private prefixedProjectRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: row.p_id as string,
      org_id: row.p_org_id as string,
      name: row.p_name as string,
      slug: row.p_slug as string,
      description: row.p_description as string | null,
      status: row.p_status as ProjectStatus,
      environment: row.p_environment as ProjectEnvironment,
      archived_at: row.p_archived_at as Date | null,
      deleted_at: row.p_deleted_at as Date | null,
      created_at: row.p_created_at as Date,
      updated_at: row.p_updated_at as Date,
    } as any;
  }


  private mapProject(row: ProjectRow): Project {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      environment: row.environment,
      productionApiPrefix: null,
      developmentApiPrefix: null,
      stagingApiPrefix: null,
      rateLimitPerSecond: 0,
      rateLimitPerMinute: 0,
      rateLimitPerHour: 0,
      burstLimit: 0,
      allowedEventTypes: [],
      maxEventSizeBytes: 0,
      maxBatchSize: 0,
      allowedOrigins: [],
      requireHttps: false,
      ipAllowlist: null,
      ipBlocklist: null,
      geoRestrictionEnabled: false,
      allowedCountries: null,
      alertEmail: null,
      alertWebhookUrl: null,
      alertOnErrorRateThreshold: 0,
      alertOnLatencyThresholdMs: 0,
      metadata: {},
      settings: {},
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      deletedBy: null,
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
}
