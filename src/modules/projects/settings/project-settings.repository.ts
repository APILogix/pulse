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

export class ProjectSettingsRepository {
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

  // ── Mapping helpers ─────────────────────────────────────────────────────────
}
