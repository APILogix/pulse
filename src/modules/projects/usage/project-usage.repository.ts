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

export class ProjectUsageRepository {
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

  // ── Mapping helpers ─────────────────────────────────────────────────────────
}
