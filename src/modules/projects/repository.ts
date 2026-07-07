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
import { pool } from "../../config/database.js";
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
  ProjectUsageCounter,
  ProjectStatus,
} from "./types.js";
import { ProjectError } from "./utils.js";

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
export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  environment?: ProjectEnvironment;
  productionApiPrefix?: string | null;
  developmentApiPrefix?: string | null;
  stagingApiPrefix?: string | null;
  rateLimitPerSecond?: number;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
  burstLimit?: number;
  allowedEventTypes?: string[];
  maxEventSizeBytes?: number;
  maxBatchSize?: number;
  allowedOrigins?: string[];
  requireHttps?: boolean;
  ipAllowlist?: string[] | null;
  ipBlocklist?: string[] | null;
  geoRestrictionEnabled?: boolean;
  allowedCountries?: string[] | null;
  alertEmail?: string | null;
  alertWebhookUrl?: string | null;
  alertOnErrorRateThreshold?: number;
  alertOnLatencyThresholdMs?: number;
  metadata?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  archivedAt?: Date | null;
}

export interface ApiKeyUpdateInput {
  name?: string | null;
  description?: string | null;
  expiresAt?: Date | null;
  autoRotateEnabled?: boolean;
  autoRotateDays?: number;
  permissions?: string[];
  allowedEndpoints?: string[];
  blockedEndpoints?: string[];
  rateLimitPerSecond?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
}

export interface ProjectModuleUsageCounts {
  projects: number;
  environments: number;
  apiKeys: number;
}

const DEFAULT_PROJECT_ENVIRONMENTS: ProjectEnvironment[] = ["development", "staging", "production"];

export class ProjectsRepository {
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

  async findOrganizationMembership(
    orgId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<OrganizationMembership | null> {
    const db = client ?? this.db;
    // organization_members uses a `status` column, not is_active; derive it.
    const result = await db.query<MembershipRow>(
      `SELECT org_id, user_id, role, (status = 'active') AS is_active
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2
        LIMIT 1`,
      [orgId, userId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      orgId: row.org_id,
      userId: row.user_id,
      role: row.role,
      isActive: row.is_active,
    };
  }

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

  async getProjectStats(
    projectId: string,
    client?: PoolClient,
  ): Promise<{
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
    environmentCount: number;
  }> {
    const db = client ?? this.db;
    const result = await db.query<{
      api_keys_count: string;
      active_keys_count: string;
      environment_count: string;
      total_requests: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1)::text AS api_keys_count,
         (SELECT COUNT(*) FROM project_api_keys WHERE project_id = $1 AND is_active = TRUE)::text AS active_keys_count,
         (SELECT COUNT(*) FROM project_environments WHERE project_id = $1)::text AS environment_count,
         GREATEST(
           COALESCE((SELECT SUM(request_count) FROM project_api_key_usage WHERE project_id = $1),0),
           COALESCE((SELECT SUM(usage_count) FROM project_api_keys WHERE project_id = $1),0)
         )::text AS total_requests`,
      [projectId],
    );

    const row = result.rows[0];
    return {
      totalRequests: Number.parseInt(row?.total_requests ?? "0", 10),
      apiKeysCount: Number.parseInt(row?.api_keys_count ?? "0", 10),
      activeKeysCount: Number.parseInt(row?.active_keys_count ?? "0", 10),
      environmentCount: Number.parseInt(row?.environment_count ?? "0", 10),
    };
  }

  async getProjectUsageCounters(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectUsageCounter[]> {
    const db = client ?? this.db;
    const result = await db.query<{
      counter_type: string;
      total_value: string;
      last_period_start: Date | null;
      last_period_end: Date | null;
      last_flushed_at: Date | null;
    }>(
      `SELECT
         counter_type,
         COALESCE(SUM(total_value),0)::text AS total_value,
         MAX(period_start) AS last_period_start,
         MAX(period_end) AS last_period_end,
         MAX(last_flushed_at) AS last_flushed_at
       FROM project_usage_realtime
       WHERE project_id = $1
       GROUP BY counter_type
       ORDER BY counter_type ASC`,
      [projectId],
    );

    return result.rows.map((row) => ({
      counterType: row.counter_type,
      totalValue: Number.parseInt(row.total_value ?? "0", 10),
      lastPeriodStart: row.last_period_start,
      lastPeriodEnd: row.last_period_end,
      lastFlushedAt: row.last_flushed_at,
    }));
  }

  async listProjectActivity(
    orgId: string,
    projectId: string,
    query: ListProjectActivityQuery,
    client?: PoolClient,
  ): Promise<ProjectActivityResult> {
    const db = client ?? this.db;
    const params: unknown[] = [orgId, projectId];
    const whereClauses = [
      "a.org_id = $1",
      `(
        (a.entity_type = 'project' AND a.entity_id = $2::uuid)
        OR a.metadata ->> 'projectId' = $2
        OR a.new_values ->> 'projectId' = $2
        OR a.old_values ->> 'projectId' = $2
        OR (a.entity_type = 'api_key' AND EXISTS (
          SELECT 1 FROM project_api_keys k WHERE k.id = a.entity_id AND k.project_id = $2::uuid
        ))
        OR (a.entity_type = 'project_environment' AND EXISTS (
          SELECT 1 FROM project_environments e WHERE e.id = a.entity_id AND e.project_id = $2::uuid
        ))
      )`,
    ];

    if (query.action) {
      params.push(query.action);
      whereClauses.push(`a.action = $${params.length}`);
    }
    if (query.cursor) {
      params.push(query.cursor);
      whereClauses.push(`a.created_at < $${params.length}`);
    }

    params.push(query.limit + 1);
    const result = await db.query<ProjectActivityRow>(
      `SELECT
         a.id,
         a.actor_user_id,
         a.actor_email,
         a.action,
         a.entity_type,
         a.entity_id,
         a.entity_name,
         a.changed_fields,
         a.status,
         a.is_sensitive,
         a.metadata,
         a.created_at
       FROM organization_audit_logs a
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`,
      params,
    );

    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    return {
      data: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        changedFields: row.changed_fields,
        status: row.status,
        isSensitive: row.is_sensitive,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
      })),
      meta: {
        hasMore,
        nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1]!.created_at.toISOString() : null,
        limit: query.limit,
      },
    };
  }

  async getProjectModuleUsageCounts(
    orgId: string,
    client?: PoolClient,
  ): Promise<ProjectModuleUsageCounts> {
    const db = client ?? this.db;
    const result = await db.query<{
      projects: string;
      environments: string;
      api_keys: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE org_id = $1 AND deleted_at IS NULL)::text AS projects,
         (SELECT COUNT(*) FROM project_environments WHERE org_id = $1)::text AS environments,
         (SELECT COUNT(*) FROM project_api_keys WHERE org_id = $1 AND is_active = TRUE)::text AS api_keys`,
      [orgId],
    );

    const row = result.rows[0];
    return {
      projects: Number.parseInt(row?.projects ?? "0", 10),
      environments: Number.parseInt(row?.environments ?? "0", 10),
      apiKeys: Number.parseInt(row?.api_keys ?? "0", 10),
    };
  }

  async findSdkConfigPlanKey(
    orgId: string,
    client?: PoolClient,
  ): Promise<string> {
    const db = client ?? this.db;
    try {
      const result = await db.query<{ plan_key: string }>(
        `SELECT p.key AS plan_key
           FROM organization_subscriptions s
           INNER JOIN plans p ON p.id = s.plan_id
          WHERE s.org_id = $1
            AND s.status IN ('trialing','active','past_due')
            AND p.is_active = TRUE
          ORDER BY s.current_period_end DESC, s.created_at DESC
          LIMIT 1`,
        [orgId],
      );
      return result.rows[0]?.plan_key ?? "free";
    } catch (error) {
      if ((error as { code?: string }).code === "42P01") return "free";
      throw error;
    }
  }

  async createDefaultEnvironments(
    project: Project,
    createdBy: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig[]> {
    const envs: ProjectEnvironmentConfig[] = [];
    for (const environment of DEFAULT_PROJECT_ENVIRONMENTS) {
      envs.push(
        await this.createEnvironment(
          {
            projectId: project.id,
            orgId: project.orgId,
            environment,
            createdBy,
          },
          client,
        ),
      );
    }
    return envs;
  }

  async createDefaultSdkConfigs(
    project: Project,
    createdBy: string,
    planKey: string,
    client?: PoolClient,
  ): Promise<number> {
    const db = client ?? this.db;
    const result = await db.query<{ inserted_count: string }>(
      `WITH matching_templates AS (
         SELECT
           t.environment,
           t.config_key,
           t.config_type,
           t.config_value,
           t.schema_version,
           t.target_sdk_versions,
           t.target_platforms,
           t.rollout_percentage
         FROM sdk_config_templates t
         WHERE t.plan_key = $4
           AND t.environment = ANY($5::text[])
           AND t.is_active = TRUE
       ),
       selected_templates AS (
         SELECT
           environment,
           config_key,
           config_type,
           config_value,
           schema_version,
           target_sdk_versions,
           target_platforms,
           rollout_percentage
         FROM matching_templates
         UNION ALL
         SELECT
           f.environment,
           f.config_key,
           f.config_type,
           f.config_value,
           f.schema_version,
           f.target_sdk_versions,
           f.target_platforms,
           f.rollout_percentage
         FROM sdk_config_templates f
         WHERE f.plan_key = 'free'
           AND f.environment = ANY($5::text[])
           AND f.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM matching_templates)
       ),
       prepared_configs AS (
         SELECT
           $1::uuid AS org_id,
           $2::uuid AS project_id,
           s.config_key,
           s.config_type,
           jsonb_set(
             jsonb_set(
               COALESCE(s.config_value, '{}'::jsonb),
               '{sdk,projectId}',
               to_jsonb($2::text),
               TRUE
             ),
             '{sdk,environment}',
             to_jsonb(s.environment),
             TRUE
           ) AS config_value,
           s.schema_version,
           s.environment,
           s.target_sdk_versions,
           s.target_platforms,
           s.rollout_percentage
         FROM selected_templates s
       ),
       inserted_configs AS (
         INSERT INTO sdk_configs (
           org_id,
           project_id,
           config_key,
           config_type,
           version,
           version_hash,
           is_latest,
           config_value,
           schema_version,
           environment,
           target_sdk_versions,
           target_platforms,
           rollout_percentage,
           is_active,
           is_encrypted,
           created_by,
           updated_by
         )
         SELECT
           p.org_id,
           p.project_id,
           p.config_key,
           p.config_type,
           1,
           encode(digest(p.config_value::text, 'sha256'), 'hex'),
           TRUE,
           p.config_value,
           p.schema_version,
           p.environment,
           p.target_sdk_versions,
           p.target_platforms,
           p.rollout_percentage,
           TRUE,
           FALSE,
           $3::uuid,
           $3::uuid
         FROM prepared_configs p
         ON CONFLICT (
           org_id,
           (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
           config_key,
           environment
         ) WHERE is_latest = TRUE DO NOTHING
         RETURNING id, version, version_hash, config_value, rollout_percentage
       ),
       inserted_versions AS (
         INSERT INTO sdk_config_versions (
           config_id,
           version,
           version_hash,
           config_value,
           change_type,
           change_summary,
           created_by
         )
         SELECT
           id,
           version,
           version_hash,
           config_value,
           'create',
           'Initial project SDK config',
           $3::uuid
         FROM inserted_configs
         RETURNING id
       ),
       inserted_deployments AS (
         INSERT INTO sdk_config_deployments (
           config_id,
           version,
           status,
           rollout_percentage,
           started_at
         )
         SELECT
           id,
           version,
           'deploying',
           rollout_percentage,
           NOW()
         FROM inserted_configs
         RETURNING id
       )
       SELECT COUNT(*)::text AS inserted_count FROM inserted_configs`,
      [
        project.orgId,
        project.id,
        createdBy,
        planKey,
        DEFAULT_PROJECT_ENVIRONMENTS,
      ],
    );
    return Number.parseInt(result.rows[0]?.inserted_count ?? "0", 10);
  }

  // ── Environments ─────────────────────────────────────────────────────────

  async listEnvironments(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig[]> {
    const db = client ?? this.db;
    const result = await db.query<EnvRow>(
      `SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1
        ORDER BY environment ASC`,
      [projectId],
    );
    return result.rows.map((row) => this.mapEnv(row));
  }

  async findEnvironment(
    projectId: string,
    environment: ProjectEnvironment,
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig | null> {
    const db = client ?? this.db;
    const result = await db.query<EnvRow>(
      `SELECT ${ENV_COLUMNS} FROM project_environments
        WHERE project_id = $1 AND environment = $2
        LIMIT 1`,
      [projectId, environment],
    );
    return result.rows[0] ? this.mapEnv(result.rows[0]) : null;
  }

  async createEnvironment(
    input: {
      projectId: string;
      orgId: string;
      environment: ProjectEnvironment;
      createdBy: string;
      isActive?: boolean | undefined;
      rateLimitPerSecond?: number | null | undefined;
      rateLimitPerMinute?: number | null | undefined;
      rateLimitPerHour?: number | null | undefined;
      burstLimit?: number | null | undefined;
      allowedEventTypes?: string[] | undefined;
      maxEventSizeBytes?: number | null | undefined;
      maxBatchSize?: number | null | undefined;
      requireHttps?: boolean | undefined;
      ipAllowlist?: string[] | null | undefined;
      ipBlocklist?: string[] | null | undefined;
      alertEmail?: string | null | undefined;
      alertWebhookUrl?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    const db = client ?? this.db;
    try {
      const result = await db.query<EnvRow>(
        `INSERT INTO project_environments (
           project_id, org_id, environment, is_active,
           rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
           allowed_event_types, max_event_size_bytes, max_batch_size,
           require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url, created_by
         ) VALUES (
           $1,$2,$3,COALESCE($4,TRUE),
           $5,$6,$7,$8,
           COALESCE($9::text[],ARRAY['*']::text[]), $10, $11,
           COALESCE($12,TRUE), $13::inet[], $14::inet[], $15, $16, $17
         )
         RETURNING ${ENV_COLUMNS}`,
        [
          input.projectId,
          input.orgId,
          input.environment,
          input.isActive ?? null,
          input.rateLimitPerSecond ?? null,
          input.rateLimitPerMinute ?? null,
          input.rateLimitPerHour ?? null,
          input.burstLimit ?? null,
          input.allowedEventTypes ?? null,
          input.maxEventSizeBytes ?? null,
          input.maxBatchSize ?? null,
          input.requireHttps ?? null,
          input.ipAllowlist ?? null,
          input.ipBlocklist ?? null,
          input.alertEmail ?? null,
          input.alertWebhookUrl ?? null,
          input.createdBy,
        ],
      );
      return this.mapEnv(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ProjectError(
          "ENVIRONMENT_EXISTS",
          "This environment already exists for the project",
          409,
        );
      }
      throw error;
    }
  }

  async updateEnvironment(
    projectId: string,
    environment: ProjectEnvironment,
    input: {
      isActive?: boolean | undefined;
      rateLimitPerSecond?: number | null | undefined;
      rateLimitPerMinute?: number | null | undefined;
      rateLimitPerHour?: number | null | undefined;
      burstLimit?: number | null | undefined;
      allowedEventTypes?: string[] | undefined;
      maxEventSizeBytes?: number | null | undefined;
      maxBatchSize?: number | null | undefined;
      requireHttps?: boolean | undefined;
      ipAllowlist?: string[] | null | undefined;
      ipBlocklist?: string[] | null | undefined;
      alertEmail?: string | null | undefined;
      alertWebhookUrl?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<ProjectEnvironmentConfig> {
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      assignments.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (input.isActive !== undefined) set("is_active", input.isActive);
    if (input.rateLimitPerSecond !== undefined) set("rate_limit_per_second", input.rateLimitPerSecond);
    if (input.rateLimitPerMinute !== undefined) set("rate_limit_per_minute", input.rateLimitPerMinute);
    if (input.rateLimitPerHour !== undefined) set("rate_limit_per_hour", input.rateLimitPerHour);
    if (input.burstLimit !== undefined) set("burst_limit", input.burstLimit);
    if (input.allowedEventTypes !== undefined) set("allowed_event_types", input.allowedEventTypes);
    if (input.maxEventSizeBytes !== undefined) set("max_event_size_bytes", input.maxEventSizeBytes);
    if (input.maxBatchSize !== undefined) set("max_batch_size", input.maxBatchSize);
    if (input.requireHttps !== undefined) set("require_https", input.requireHttps);
    if (input.ipAllowlist !== undefined) set("ip_allowlist", input.ipAllowlist);
    if (input.ipBlocklist !== undefined) set("ip_blocklist", input.ipBlocklist);
    if (input.alertEmail !== undefined) set("alert_email", input.alertEmail);
    if (input.alertWebhookUrl !== undefined) set("alert_webhook_url", input.alertWebhookUrl);

    if (assignments.length === 0) {
      const env = await this.findEnvironment(projectId, environment, client);
      if (!env) {
        throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
      }
      return env;
    }

    values.push(projectId, environment);
    const result = await db.query<EnvRow>(
      `UPDATE project_environments
          SET ${assignments.join(", ")}
        WHERE project_id = $${values.length - 1} AND environment = $${values.length}
        RETURNING ${ENV_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
    }
    return this.mapEnv(result.rows[0]!);
  }

  async deleteEnvironment(
    projectId: string,
    environment: ProjectEnvironment,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `DELETE FROM project_environments WHERE project_id = $1 AND environment = $2`,
      [projectId, environment],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("ENVIRONMENT_NOT_FOUND", "Environment not found", 404);
    }
  }

  // ── API keys ─────────────────────────────────────────────────────────────

  async listApiKeys(
    projectId: string,
    query: ListApiKeysQuery,
    client?: PoolClient,
  ): Promise<{ keys: ProjectApiKey[]; total: number }> {
    const db = client ?? this.db;
    const params: Array<string | number | boolean> = [projectId];
    const whereClauses = ["project_id = $1"];

    if (query.environment) {
      params.push(query.environment);
      whereClauses.push(`environment = $${params.length}`);
    }
    if (query.keyType) {
      params.push(query.keyType);
      whereClauses.push(`key_type = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      whereClauses.push(`status = $${params.length}`);
    }
    if (query.isActive !== undefined) {
      params.push(query.isActive);
      whereClauses.push(`is_active = $${params.length}`);
    } else if (query.includeInactive === false) {
      whereClauses.push("is_active = TRUE");
    }

    const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM project_api_keys ${whereClause}`,
      params,
    );

    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    params.push(query.limit, offset);

    const result = await db.query<ApiKeyRow>(
      `SELECT ${API_KEY_COLUMNS} FROM project_api_keys
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
      orgId: string;
      keyHash: string;
      keyPrefix: string;
      keyType: ApiKeyType;
      environment: ProjectEnvironment;
      name: string | null;
      description: string | null;
      createdBy: string;
      expiresAt: Date | null;
      autoRotateEnabled?: boolean | undefined;
      autoRotateDays?: number | undefined;
      permissions: string[];
      allowedEndpoints?: string[] | undefined;
      blockedEndpoints?: string[] | undefined;
      rateLimitPerSecond?: number | null | undefined;
      rateLimitPerMinute?: number | null | undefined;
      rateLimitPerHour?: number | null | undefined;
      rotatedFromKeyId?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord> {
    const db = client ?? this.db;
    try {
      const result = await db.query<ApiKeyRow>(
        `INSERT INTO project_api_keys (
           project_id, org_id, key_hash, key_prefix, key_type, environment,
           name, description, created_by, expires_at,
           auto_rotate_enabled, auto_rotate_days,
           permissions, allowed_endpoints, blocked_endpoints,
           rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
           rotated_from_key_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,
           COALESCE($11,FALSE), COALESCE($12,90),
           $13, COALESCE($14,ARRAY['*']), COALESCE($15,'{}'),
           $16,$17,$18,
           $19
         )
         RETURNING ${API_KEY_COLUMNS}`,
        [
          input.projectId,
          input.orgId,
          input.keyHash,
          input.keyPrefix,
          input.keyType,
          input.environment,
          input.name,
          input.description,
          input.createdBy,
          input.expiresAt,
          input.autoRotateEnabled ?? null,
          input.autoRotateDays ?? null,
          input.permissions,
          input.allowedEndpoints ?? null,
          input.blockedEndpoints ?? null,
          input.rateLimitPerSecond ?? null,
          input.rateLimitPerMinute ?? null,
          input.rateLimitPerHour ?? null,
          input.rotatedFromKeyId ?? null,
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
      `SELECT COUNT(*)::text AS count FROM project_api_keys
        WHERE project_id = $1 AND environment = $2 AND is_active = TRUE`,
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
      `SELECT ${API_KEY_COLUMNS} FROM project_api_keys
        WHERE project_id = $1 AND id = $2 LIMIT 1`,
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
      `SELECT ${API_KEY_COLUMNS} FROM project_api_keys
        WHERE project_id = $1 AND id = $2 LIMIT 1`,
      [projectId, apiKeyId],
    );
    return result.rows[0] ? this.mapApiKeyRecord(result.rows[0]) : null;
  }

  async listActiveApiKeyRecords(
    projectId: string,
    environment: ProjectEnvironment | undefined,
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord[]> {
    const db = client ?? this.db;
    const params: Array<string> = [projectId];
    let where = "project_id = $1 AND is_active = TRUE";
    if (environment) {
      params.push(environment);
      where += ` AND environment = $${params.length}`;
    }
    const result = await db.query<ApiKeyRow>(
      `SELECT ${API_KEY_COLUMNS} FROM project_api_keys WHERE ${where}`,
      params,
    );
    return result.rows.map((row) => this.mapApiKeyRecord(row));
  }

  async updateApiKey(
    projectId: string,
    apiKeyId: string,
    input: ApiKeyUpdateInput,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      assignments.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (input.name !== undefined) set("name", input.name);
    if (input.description !== undefined) set("description", input.description);
    if (input.expiresAt !== undefined) set("expires_at", input.expiresAt);
    if (input.autoRotateEnabled !== undefined) set("auto_rotate_enabled", input.autoRotateEnabled);
    if (input.autoRotateDays !== undefined) set("auto_rotate_days", input.autoRotateDays);
    if (input.permissions !== undefined) set("permissions", input.permissions);
    if (input.allowedEndpoints !== undefined) set("allowed_endpoints", input.allowedEndpoints);
    if (input.blockedEndpoints !== undefined) set("blocked_endpoints", input.blockedEndpoints);
    if (input.rateLimitPerSecond !== undefined) set("rate_limit_per_second", input.rateLimitPerSecond);
    if (input.rateLimitPerMinute !== undefined) set("rate_limit_per_minute", input.rateLimitPerMinute);
    if (input.rateLimitPerHour !== undefined) set("rate_limit_per_hour", input.rateLimitPerHour);

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
        WHERE project_id = $${values.length - 1} AND id = $${values.length}
        RETURNING ${API_KEY_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.mapApiKey(result.rows[0]!);
  }

  /** Enable/disable the fast ingestion gate and sync the lifecycle status. */
  async setApiKeyActiveState(
    projectId: string,
    apiKeyId: string,
    isActive: boolean,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
          SET is_active = $3,
              status = CASE WHEN $3 THEN 'active'::api_key_status ELSE 'suspended'::api_key_status END
        WHERE project_id = $1 AND id = $2
        RETURNING ${API_KEY_COLUMNS}`,
      [projectId, apiKeyId, isActive],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.mapApiKey(result.rows[0]!);
  }

  /** Revoke a key permanently: deactivate, set status + reason + actor. */
  async revokeApiKey(
    projectId: string,
    apiKeyId: string,
    revokedBy: string,
    reason: string | null,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
          SET is_active = FALSE,
              status = 'revoked',
              revoked_at = NOW(),
              revoked_by = $3,
              revoked_reason = $4
        WHERE project_id = $1 AND id = $2
        RETURNING ${API_KEY_COLUMNS}`,
      [projectId, apiKeyId, revokedBy, reason],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.mapApiKey(result.rows[0]!);
  }

  /**
   * Mark a rotated key. If gracePeriodEndsAt is in the future the key stays
   * active (is_active stays TRUE) until then; otherwise it is deactivated now.
   */
  async markApiKeyRotated(
    projectId: string,
    apiKeyId: string,
    rotatedBy: string,
    reason: string | null,
    gracePeriodEndsAt: Date | null,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const keepActive = !!gracePeriodEndsAt && gracePeriodEndsAt.getTime() > Date.now();
    const result = await db.query(
      `UPDATE project_api_keys
          SET status = 'rotated',
              rotated_at = NOW(),
              rotated_by = $3,
              rotation_reason = $4,
              grace_period_ends_at = $5,
              is_active = $6
        WHERE project_id = $1 AND id = $2`,
      [projectId, apiKeyId, rotatedBy, reason, gracePeriodEndsAt, keepActive],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
  }

  async touchApiKeyLastUsed(
    apiKeyId: string,
    ip?: string | null,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `UPDATE project_api_keys
          SET last_used_at = NOW(),
              last_used_ip = COALESCE($2::inet, last_used_ip),
              usage_count = usage_count + 1
        WHERE id = $1`,
      [apiKeyId, ip ?? null],
    );
  }

  /** All key hashes of a project, for cache eviction on pause/archive/delete. */
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

  /**
   * Candidate lookup for verification. Narrows by prefix to the small set of
   * keys that could match, then the service does the constant-time hash compare.
   * Includes keys that are active OR in a still-valid rotation grace window.
   */
  async findActiveApiKeyCandidatesByPrefix(
    keyPrefix: string,
    client?: PoolClient,
  ): Promise<Array<{ apiKey: ProjectApiKeyRecord; project: Project }>> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow & ProjectRow & { p_id: string }>(
      `SELECT
         ${API_KEY_COLUMNS.split(",").map((c) => `k.${c.trim()}`).join(", ")},
         p.id AS p_id, p.org_id AS p_org_id, p.name AS p_name, p.slug AS p_slug,
         p.description AS p_description, p.status AS p_status, p.environment AS p_environment,
         p.production_api_prefix AS p_production_api_prefix,
         p.development_api_prefix AS p_development_api_prefix,
         p.staging_api_prefix AS p_staging_api_prefix,
         p.rate_limit_per_second AS p_rate_limit_per_second,
         p.rate_limit_per_minute AS p_rate_limit_per_minute,
         p.rate_limit_per_hour AS p_rate_limit_per_hour,
         p.burst_limit AS p_burst_limit,
         p.allowed_event_types AS p_allowed_event_types,
         p.max_event_size_bytes AS p_max_event_size_bytes,
         p.max_batch_size AS p_max_batch_size,
         p.allowed_origins AS p_allowed_origins,
         p.require_https AS p_require_https,
         p.ip_allowlist AS p_ip_allowlist,
         p.ip_blocklist AS p_ip_blocklist,
         p.geo_restriction_enabled AS p_geo_restriction_enabled,
         p.allowed_countries AS p_allowed_countries,
         p.alert_email AS p_alert_email,
         p.alert_webhook_url AS p_alert_webhook_url,
         p.alert_on_error_rate_threshold AS p_alert_on_error_rate_threshold,
         p.alert_on_latency_threshold_ms AS p_alert_on_latency_threshold_ms,
         p.metadata AS p_metadata, p.settings AS p_settings,
         p.archived_at AS p_archived_at, p.deleted_at AS p_deleted_at,
         p.deleted_by AS p_deleted_by,
         p.created_at AS p_created_at, p.updated_at AS p_updated_at
       FROM project_api_keys k
       INNER JOIN projects p ON p.id = k.project_id
       WHERE k.key_prefix = $1
         AND p.deleted_at IS NULL
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND (
           k.is_active = TRUE
           OR (k.status = 'rotated' AND k.grace_period_ends_at IS NOT NULL AND k.grace_period_ends_at > NOW())
         )`,
      [keyPrefix],
    );

    return result.rows.map((row) => ({
      apiKey: this.mapApiKeyRecord(row as unknown as ApiKeyRow),
      project: this.mapProject(this.prefixedProjectRow(row)),
    }));
  }

  // ── Usage rollups ──────────────────────────────────────────────────────────

  async getApiKeyUsageSummary(
    keyId: string,
    client?: PoolClient,
  ): Promise<{
    totalRequests: number;
    totalSuccess: number;
    totalErrors: number;
    bytesIngested: number;
    eventsIngested: number;
    requestsByDay: Array<{ date: string; count: number }>;
  }> {
    const db = client ?? this.db;
    const totals = await db.query<{
      total_requests: string;
      total_success: string;
      total_errors: string;
      bytes_ingested: string;
      events_ingested: string;
    }>(
      `SELECT
         COALESCE(SUM(request_count),0)::text AS total_requests,
         COALESCE(SUM(success_count),0)::text AS total_success,
         COALESCE(SUM(error_count),0)::text AS total_errors,
         COALESCE(SUM(bytes_ingested),0)::text AS bytes_ingested,
         COALESCE(SUM(events_ingested),0)::text AS events_ingested
       FROM project_api_key_usage
       WHERE key_id = $1`,
      [keyId],
    );

    const daily = await db.query<{ d: string; c: string }>(
      `SELECT to_char(usage_date,'YYYY-MM-DD') AS d, SUM(request_count)::text AS c
         FROM project_api_key_usage
        WHERE key_id = $1 AND usage_date >= (CURRENT_DATE - INTERVAL '30 days')
        GROUP BY usage_date
        ORDER BY usage_date DESC`,
      [keyId],
    );

    const t = totals.rows[0];
    return {
      totalRequests: Number.parseInt(t?.total_requests ?? "0", 10),
      totalSuccess: Number.parseInt(t?.total_success ?? "0", 10),
      totalErrors: Number.parseInt(t?.total_errors ?? "0", 10),
      bytesIngested: Number.parseInt(t?.bytes_ingested ?? "0", 10),
      eventsIngested: Number.parseInt(t?.events_ingested ?? "0", 10),
      requestsByDay: daily.rows.map((r) => ({
        date: r.d,
        count: Number.parseInt(r.c ?? "0", 10),
      })),
    };
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

  private mapEnv(row: EnvRow): ProjectEnvironmentConfig {
    return {
      id: row.id,
      projectId: row.project_id,
      orgId: row.org_id,
      environment: row.environment,
      isActive: row.is_active,
      rateLimitPerSecond: row.rate_limit_per_second,
      rateLimitPerMinute: row.rate_limit_per_minute,
      rateLimitPerHour: row.rate_limit_per_hour,
      burstLimit: row.burst_limit,
      allowedEventTypes: row.allowed_event_types ?? [],
      maxEventSizeBytes: row.max_event_size_bytes,
      maxBatchSize: row.max_batch_size,
      requireHttps: row.require_https,
      ipAllowlist: row.ip_allowlist,
      ipBlocklist: row.ip_blocklist,
      alertEmail: row.alert_email,
      alertWebhookUrl: row.alert_webhook_url,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApiKey(row: ApiKeyRow): ProjectApiKey {
    return {
      id: row.id,
      projectId: row.project_id,
      orgId: row.org_id,
      keyPrefix: row.key_prefix,
      keyType: row.key_type,
      environment: row.environment,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      status: row.status,
      createdBy: row.created_by,
      rotatedFromKeyId: row.rotated_from_key_id,
      rotatedAt: row.rotated_at,
      rotatedBy: row.rotated_by,
      rotationReason: row.rotation_reason,
      gracePeriodEndsAt: row.grace_period_ends_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      revokedReason: row.revoked_reason,
      expiresAt: row.expires_at,
      autoRotateEnabled: row.auto_rotate_enabled,
      autoRotateDays: Number(row.auto_rotate_days ?? 90),
      lastUsedAt: row.last_used_at,
      lastUsedIp: row.last_used_ip,
      usageCount: Number(row.usage_count ?? 0),
      errorCount: Number(row.error_count ?? 0),
      rateLimitPerSecond: row.rate_limit_per_second,
      rateLimitPerMinute: row.rate_limit_per_minute,
      rateLimitPerHour: row.rate_limit_per_hour,
      permissions: row.permissions ?? [],
      allowedEndpoints: row.allowed_endpoints ?? [],
      blockedEndpoints: row.blocked_endpoints ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord {
    return {
      ...this.mapApiKey(row),
      keyHash: row.key_hash,
    };
  }
}
