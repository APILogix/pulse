/**
 * Project API key repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Execute parameterized SQL against project_api_keys and project_environments.
 * 3. Map snake_case rows into camelCase domain objects.
 * 4. Translate expected DB conflicts/misses into ProjectError with stable codes.
 *
 * Tenant isolation: every API key query is scoped by org_id (and project_id).
 * Soft delete: API keys use deleted_at; reads filter deleted_at IS NULL.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type {
  ApiKeyRotationState,
  ApiKeyStatus,
  ApiKeyType,
  ListApiKeysQuery,
  Project,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectStatus,
} from "../types.js";
import { ProjectError } from "../shared/utils.js";

const API_KEY_COLUMNS = `
  id, project_id, org_id, public_key, secret_hash, environment_id, key_type,
  name, description, is_active, status, created_by,
  rotated_from_key_id, rotated_at, rotated_by, rotation_reason, grace_period_ends_at,
  revoked_at, revoked_by, revoked_reason, expires_at,
  auto_rotate_enabled, auto_rotate_days,
  last_used_at, last_used_ip, usage_count, error_count,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
  permissions, allowed_endpoints, blocked_endpoints,
  allowed_sdks, allowed_origins, allowed_ips, allowed_domains, allowed_event_types,
  sampling_rules, feature_flags, sdk_config,
  rotation_state, rotation_version,
  metadata, deleted_at, version,
  created_at, updated_at
`;

type ApiKeyRow = {
  id: string;
  project_id: string;
  org_id: string | null;
  public_key: string;
  secret_hash: string;
  environment_id: string;
  key_type: ApiKeyType;
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
  allowed_sdks: string[] | null;
  allowed_origins: string[] | null;
  allowed_ips: string[] | null;
  allowed_domains: string[] | null;
  allowed_event_types: string[] | null;
  sampling_rules: Record<string, unknown> | null;
  feature_flags: Record<string, unknown> | null;
  sdk_config: Record<string, unknown> | null;
  rotation_state: string;
  rotation_version: number;
  metadata: Record<string, unknown> | null;
  deleted_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  visibility: string;
  timezone: string;
  tags: string[];
  icon: string | null;
  color: string | null;
  metadata: Record<string, unknown> | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
};

export interface ApiKeyUpdateInput {
  name?: string | null;
  description?: string | null;
  expiresAt?: Date | null;
  autoRotateEnabled?: boolean;
  autoRotateDays?: number;
  permissions?: string[];
  allowedEndpoints?: string[];
  blockedEndpoints?: string[];
  allowedEventTypes?: string[];
  allowedOrigins?: string[];
  allowedIps?: string[];
  allowedDomains?: string[];
  samplingRules?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  sdkConfig?: Record<string, unknown>;
  rateLimitPerSecond?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
  version?: number;
}

export class ApiKeyRepository {
  constructor(private readonly db: Pool = pool) {}

  async listApiKeys(
    projectId: string,
    query: ListApiKeysQuery,
    client?: PoolClient,
  ): Promise<{ keys: ProjectApiKey[]; total: number }> {
    const db = client ?? this.db;
    const params: Array<string | number | boolean> = [projectId];
    const whereClauses = ["project_id = $1", "deleted_at IS NULL"];

    if (query.environmentId) {
      params.push(query.environmentId);
      whereClauses.push(`environment_id = $${params.length}`);
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
      publicKey: string;
      secretHash: string;
      keyType: ApiKeyType;
      environmentId: string;
      name: string | null;
      description: string | null;
      createdBy: string;
      expiresAt: Date | null;
      autoRotateEnabled?: boolean | undefined;
      autoRotateDays?: number | undefined;
      permissions: string[];
      allowedEndpoints?: string[] | undefined;
      blockedEndpoints?: string[] | undefined;
      allowedEventTypes?: string[] | undefined;
      allowedOrigins?: string[] | undefined;
      allowedIps?: string[] | undefined;
      allowedDomains?: string[] | undefined;
      samplingRules?: Record<string, unknown> | undefined;
      featureFlags?: Record<string, unknown> | undefined;
      sdkConfig?: Record<string, unknown> | undefined;
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
           project_id, org_id, public_key, secret_hash, environment_id, key_type,
           name, description, created_by, expires_at,
           auto_rotate_enabled, auto_rotate_days,
           permissions, allowed_endpoints, blocked_endpoints,
           allowed_sdks, allowed_origins, allowed_ips, allowed_domains, allowed_event_types,
           sampling_rules, feature_flags, sdk_config,
           rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
           rotated_from_key_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,
           COALESCE($11,FALSE), COALESCE($12,90),
           $13, COALESCE($14,ARRAY['*']), COALESCE($15,'{}'),
           COALESCE($16::text[],ARRAY['*']::text[]), COALESCE($17,'{}'), COALESCE($18::inet[],'{}'::inet[]), COALESCE($19,'{}'), COALESCE($20,ARRAY['*']::text[]),
           COALESCE($21,'{}'), COALESCE($22,'{}'), COALESCE($23,'{}'),
           $24,$25,$26,
           $27
         )
         RETURNING ${API_KEY_COLUMNS}`,
        [
          input.projectId,
          input.orgId,
          input.publicKey,
          input.secretHash,
          input.environmentId,
          input.keyType,
          input.name,
          input.description,
          input.createdBy,
          input.expiresAt,
          input.autoRotateEnabled ?? null,
          input.autoRotateDays ?? null,
          input.permissions,
          input.allowedEndpoints ?? null,
          input.blockedEndpoints ?? null,
          null, // allowed_sdks defaults to ARRAY['*']
          input.allowedOrigins ?? null,
          input.allowedIps ?? null,
          input.allowedDomains ?? null,
          input.allowedEventTypes ?? null,
          input.samplingRules ?? null,
          input.featureFlags ?? null,
          input.sdkConfig ?? null,
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
    environmentId: string,
    client?: PoolClient,
  ): Promise<number> {
    const db = client ?? this.db;
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM project_api_keys
        WHERE project_id = $1 AND environment_id = $2 AND is_active = TRUE AND deleted_at IS NULL`,
      [projectId, environmentId],
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
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
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
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
      [projectId, apiKeyId],
    );
    return result.rows[0] ? this.mapApiKeyRecord(result.rows[0]) : null;
  }

  async listActiveApiKeyRecords(
    projectId: string,
    environmentId: string | undefined,
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord[]> {
    const db = client ?? this.db;
    const params: Array<string> = [projectId];
    let where = "project_id = $1 AND is_active = TRUE AND deleted_at IS NULL";
    if (environmentId) {
      params.push(environmentId);
      where += ` AND environment_id = $${params.length}`;
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
    if (input.allowedEventTypes !== undefined) set("allowed_event_types", input.allowedEventTypes);
    if (input.allowedOrigins !== undefined) set("allowed_origins", input.allowedOrigins);
    if (input.allowedIps !== undefined) set("allowed_ips", input.allowedIps);
    if (input.allowedDomains !== undefined) set("allowed_domains", input.allowedDomains);
    if (input.samplingRules !== undefined) set("sampling_rules", input.samplingRules);
    if (input.featureFlags !== undefined) set("feature_flags", input.featureFlags);
    if (input.sdkConfig !== undefined) set("sdk_config", input.sdkConfig);
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
    const expectedVersion = input.version;
    if (expectedVersion !== undefined) values.splice(values.length - 1, 0, expectedVersion);

    const projectIdIdx = values.length - (expectedVersion !== undefined ? 3 : 2);
    const apiKeyIdIdx = values.length - 1;
    const versionIdx = expectedVersion !== undefined ? values.length - 2 : null;
    const versionCondition = expectedVersion !== undefined ? ` AND version = $${versionIdx}` : "";

    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
          SET ${assignments.join(", ")}
        WHERE project_id = $${projectIdIdx}
          AND id = $${apiKeyIdIdx}
          AND deleted_at IS NULL${versionCondition}
        RETURNING ${API_KEY_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      if (expectedVersion !== undefined) {
        const current = await this.findApiKeyById(projectId, apiKeyId, client);
        if (current) {
          throw new ProjectError(
            "API_KEY_CONCURRENT_UPDATE",
            "API key was modified by another request. Please refresh and try again.",
            409,
          );
        }
      }
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
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
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
              deleted_at = COALESCE(deleted_at, NOW()),
              revoked_at = NOW(),
              revoked_by = $3,
              revoked_reason = $4
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
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
              rotation_state = 'rotating',
              rotated_at = NOW(),
              rotated_by = $3,
              rotation_reason = $4,
              grace_period_ends_at = $5,
              is_active = $6
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`,
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
        WHERE id = $1 AND deleted_at IS NULL`,
      [apiKeyId, ip ?? null],
    );
  }

  /** All key hashes of a project, for cache eviction on pause/archive/delete. */
  async listApiKeyHashesByProject(
    projectId: string,
    client?: PoolClient,
  ): Promise<string[]> {
    const db = client ?? this.db;
    const result = await db.query<{ secret_hash: string }>(
      `SELECT secret_hash FROM project_api_keys WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    return result.rows.map((row) => row.secret_hash);
  }

  /**
   * Candidate lookup for verification. Narrows by public_key to the small set of
   * keys that could match, then the service does the constant-time hash compare.
   * Includes keys that are active OR in a still-valid rotation grace window.
   */
  async findActiveApiKeyCandidatesByPrefix(
    publicKey: string,
    client?: PoolClient,
  ): Promise<Array<{ apiKey: ProjectApiKeyRecord; project: Project; environmentName: string }>> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow & ProjectRow & { env_name: string }>(
      `SELECT
         ${API_KEY_COLUMNS.split(",").map((c) => `k.${c.trim()}`).join(", ")},
         p.id AS p_id, p.org_id AS p_org_id, p.name AS p_name, p.slug AS p_slug,
         p.description AS p_description, p.status AS p_status, p.visibility AS p_visibility,
         p.timezone AS p_timezone, p.tags AS p_tags, p.icon AS p_icon, p.color AS p_color,
         p.metadata AS p_metadata, p.archived_at AS p_archived_at, p.deleted_at AS p_deleted_at,
         p.deleted_by AS p_deleted_by, p.created_at AS p_created_at, p.updated_at AS p_updated_at,
         p.version AS p_version,
         e.name AS env_name
       FROM project_api_keys k
       INNER JOIN projects p ON p.id = k.project_id
       LEFT JOIN project_environments e ON e.id = k.environment_id
       WHERE k.public_key = $1
         AND p.deleted_at IS NULL
         AND k.deleted_at IS NULL
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND (
           k.is_active = TRUE
           OR (k.status = 'rotated' AND k.grace_period_ends_at IS NOT NULL AND k.grace_period_ends_at > NOW())
         )`,
      [publicKey],
    );

    return result.rows.map((row) => ({
      apiKey: this.mapApiKeyRecord(row as unknown as ApiKeyRow),
      project: this.mapProject(this.prefixedProjectRow(row)),
      environmentName: row.env_name ?? "default",
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

  /** Build a ProjectRow from the p_*-prefixed columns of the candidate join. */
  private prefixedProjectRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: row.p_id as string,
      org_id: row.p_org_id as string,
      name: row.p_name as string,
      slug: row.p_slug as string,
      description: row.p_description as string | null,
      status: row.p_status as ProjectStatus,
      visibility: row.p_visibility as string,
      timezone: row.p_timezone as string,
      tags: row.p_tags as string[],
      icon: row.p_icon as string | null,
      color: row.p_color as string | null,
      metadata: row.p_metadata as Record<string, unknown> | null,
      archived_at: row.p_archived_at as Date | null,
      deleted_at: row.p_deleted_at as Date | null,
      deleted_by: row.p_deleted_by as string | null,
      created_at: row.p_created_at as Date,
      updated_at: row.p_updated_at as Date,
      version: Number(row.p_version ?? 1),
    };
  }

  private mapProject(row: ProjectRow): Project {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      visibility: row.visibility as any,
      timezone: row.timezone,
      tags: row.tags ?? [],
      icon: row.icon,
      color: row.color,
      metadata: row.metadata ?? {},
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private mapApiKey(row: ApiKeyRow): ProjectApiKey {
    return {
      id: row.id,
      projectId: row.project_id,
      orgId: row.org_id,
      publicKey: row.public_key,
      keyType: row.key_type,
      environmentId: row.environment_id,
      environment: null,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      status: row.status,
      rotationState: row.rotation_state as ApiKeyRotationState,
      rotationVersion: row.rotation_version,
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
      allowedEventTypes: row.allowed_event_types ?? [],
      allowedOrigins: row.allowed_origins ?? [],
      allowedIps: row.allowed_ips ?? [],
      allowedDomains: row.allowed_domains ?? [],
      allowedSdks: row.allowed_sdks ?? [],
      samplingRules: row.sampling_rules ?? {},
      featureFlags: row.feature_flags ?? {},
      sdkConfig: row.sdk_config ?? {},
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord {
    return {
      ...this.mapApiKey(row),
      secretHash: row.secret_hash,
    };
  }
}
