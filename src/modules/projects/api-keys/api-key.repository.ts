/**
 * Project API key repository.
 *
 * The credential table holds identity and lifecycle only. Rotation workflow
 * history lives in `project_api_key_rotations`, and usage analytics live in the
 * partitioned `api_key_usage_minute` / `api_key_usage_daily` facts (with
 * read-only hourly/monthly views).
 *
 * Tenant isolation: every query is scoped by project (and organization for
 * writes). Soft delete: reads filter `deleted_at IS NULL`.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type {
  ApiKeyRotation,
  ApiKeyRotationState,
  ApiKeyStatus,
  ApiKeyUpdateInput,
  ApiKeyUsageGranularity,
  ApiKeyUsageSeriesPoint,
  ListApiKeysQuery,
  Project,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectStatus,
} from "../types.js";
import { ProjectError } from "../shared/utils.js";

const API_KEY_PUBLIC_COLUMNS = `
  id, organization_id, project_id, environment_id, name, public_key,
  status, expires_at, last_used_at, created_by, rotated_from_key_id,
  created_at, updated_at, deleted_at
`;

const API_KEY_COLUMNS = `
  ${API_KEY_PUBLIC_COLUMNS}, secret_hash
`;

/** Statuses that still authenticate telemetry (rotation grace is checked separately). */
const AUTHENTICATING_STATUSES = ["active", "rotated"] as const;

type ApiKeyRow = {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  name: string;
  public_key: string;
  secret_hash?: string;
  status: ApiKeyStatus;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_by: string | null;
  rotated_from_key_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

type RotationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  old_key_id: string;
  new_key_id: string | null;
  state: ApiKeyRotationState;
  reason: string | null;
  initiated_by: string | null;
  initiated_at: Date;
  grace_ends_at: Date | null;
  completed_at: Date | null;
};

type ProjectRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  timezone: string;
  tags: string[];
  icon: string | null;
  metadata: Record<string, unknown> | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
};

type UsageRow = {
  bucket: Date;
  request_count: string;
  accepted_event_count: string;
  error_event_count: string;
  ingestion_failure_count: string;
  accepted_bytes: string;
  rate_limited_request_count: string;
};

/** Physical facts and read-only projections that serve each usage grain. */
const USAGE_SOURCES: Record<ApiKeyUsageGranularity, string> = {
  hourly: "api_key_usage_hourly",
  daily: "api_key_usage_daily",
  monthly: "api_key_usage_monthly",
};

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
    if (query.status) {
      params.push(query.status);
      whereClauses.push(`status = $${params.length}`);
    } else if (query.includeInactive === false) {
      whereClauses.push("status = 'active'");
    }

    const whereClause = `WHERE ${whereClauses.join(" AND ")}`;
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM project_api_keys ${whereClause}`,
      params,
    );

    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    params.push(query.limit, offset);

    const result = await db.query<ApiKeyRow>(
      `SELECT ${API_KEY_PUBLIC_COLUMNS} FROM project_api_keys
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
      organizationId: string;
      environmentId: string;
      publicKey: string;
      secretHash: string;
      name: string;
      createdBy: string;
      expiresAt: Date | null;
      rotatedFromKeyId?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<ProjectApiKeyRecord> {
    const db = client ?? this.db;
    try {
      const result = await db.query<ApiKeyRow>(
        `INSERT INTO project_api_keys (
           organization_id, project_id, environment_id, name, public_key, secret_hash,
           created_by, expires_at, rotated_from_key_id, is_active,
           auto_rotate_enabled, usage_count, error_count,
           rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
           permissions, allowed_endpoints, blocked_endpoints, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,FALSE,0,0,0,0,0,'{}'::jsonb,'{}'::text[],'{}'::text[],'{}'::jsonb)
         RETURNING ${API_KEY_COLUMNS}`,
        [
          input.organizationId,
          input.projectId,
          input.environmentId,
          input.name,
          input.publicKey,
          input.secretHash,
          input.createdBy,
          input.expiresAt,
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
        WHERE project_id = $1 AND environment_id = $2
          AND status = 'active' AND deleted_at IS NULL`,
      [projectId, environmentId],
    );
    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async findApiKeyById(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<ProjectApiKey | null> {
    const record = await this.findApiKeyRecordById(projectId, apiKeyId, client);
    return record ? this.publicShape(record) : null;
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
    const params: string[] = [projectId];
    let where = "project_id = $1 AND status = 'active' AND deleted_at IS NULL";
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
    const set = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (input.name !== undefined) set("name", input.name);
    if (input.expiresAt !== undefined) set("expires_at", input.expiresAt);
    if (input.environmentId !== undefined) set("environment_id", input.environmentId);

    if (assignments.length === 0) {
      const apiKey = await this.findApiKeyById(projectId, apiKeyId, client);
      if (!apiKey) throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
      return apiKey;
    }

    values.push(projectId, apiKeyId);
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
          SET ${assignments.join(", ")}
        WHERE project_id = $${values.length - 1}
          AND id = $${values.length}
          AND deleted_at IS NULL
        RETURNING ${API_KEY_COLUMNS}`,
      values,
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.publicShape(this.mapApiKeyRecord(result.rows[0]!));
  }

  /** Suspend/resume ingestion. `status` is the only lifecycle source of truth. */
  async setApiKeyStatus(
    projectId: string,
    apiKeyId: string,
    status: Extract<ApiKeyStatus, "active" | "suspended">,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys SET status = $3
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING ${API_KEY_COLUMNS}`,
      [projectId, apiKeyId, status],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.publicShape(this.mapApiKeyRecord(result.rows[0]!));
  }

  /** Revoke permanently. Reason/actor are captured by audit and rotation history. */
  async revokeApiKey(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<ProjectApiKey> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow>(
      `UPDATE project_api_keys
          SET status = 'revoked', deleted_at = COALESCE(deleted_at, NOW())
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING ${API_KEY_COLUMNS}`,
      [projectId, apiKeyId],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
    return this.publicShape(this.mapApiKeyRecord(result.rows[0]!));
  }

  /** Bulk revoke all active keys for a project in a single query (PROJ-Q022). */
  async revokeAllActiveProjectApiKeys(
    projectId: string,
    client?: PoolClient,
  ): Promise<number> {
    const db = client ?? this.db;
    const result = await db.query(
      `UPDATE project_api_keys
          SET status = 'revoked', deleted_at = COALESCE(deleted_at, NOW())
        WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId],
    );
    return result.rowCount ?? 0;
  }

  /** Mark the superseded credential as rotated. Grace lives on the rotation row. */
  async markApiKeyRotated(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    const result = await db.query(
      `UPDATE project_api_keys SET status = 'rotated'
        WHERE project_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [projectId, apiKeyId],
    );
    if (result.rowCount === 0) {
      throw new ProjectError("API_KEY_NOT_FOUND", "API key not found", 404);
    }
  }

  // ── Rotation history ────────────────────────────────────────────────────────

  async recordRotation(
    input: {
      organizationId: string;
      projectId: string;
      environmentId: string;
      oldKeyId: string;
      newKeyId: string;
      reason: string | null;
      initiatedBy: string;
      graceEndsAt: Date | null;
    },
    client?: PoolClient,
  ): Promise<ApiKeyRotation> {
    const db = client ?? this.db;
    const inGrace = !!input.graceEndsAt && input.graceEndsAt.getTime() > Date.now();
    const result = await db.query<RotationRow>(
      `INSERT INTO project_api_key_rotations(
         organization_id, project_id, environment_id, old_key_id, new_key_id,
         state, reason, initiated_by, grace_ends_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, organization_id, project_id, environment_id, old_key_id, new_key_id,
                 state, reason, initiated_by, initiated_at, grace_ends_at, completed_at`,
      [
        input.organizationId,
        input.projectId,
        input.environmentId,
        input.oldKeyId,
        input.newKeyId,
        inGrace ? "grace_period" : "completed",
        input.reason,
        input.initiatedBy,
        inGrace ? input.graceEndsAt : null,
        inGrace ? null : new Date(),
      ],
    );
    return this.mapRotation(result.rows[0]!);
  }

  async listRotations(
    projectId: string,
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<ApiKeyRotation[]> {
    const db = client ?? this.db;
    const result = await db.query<RotationRow>(
      `SELECT id, organization_id, project_id, environment_id, old_key_id, new_key_id,
              state, reason, initiated_by, initiated_at, grace_ends_at, completed_at
         FROM project_api_key_rotations
        WHERE project_id = $1 AND (old_key_id = $2 OR new_key_id = $2)
        ORDER BY initiated_at DESC`,
      [projectId, apiKeyId],
    );
    return result.rows.map((row) => this.mapRotation(row));
  }

  /** Finalize grace windows that have elapsed so rotated keys stop authenticating. */
  async completeElapsedRotations(client?: PoolClient): Promise<number> {
    const db = client ?? this.db;
    const result = await db.query(
      `UPDATE project_api_key_rotations
          SET state = 'completed', completed_at = NOW()
        WHERE state = 'grace_period'
          AND grace_ends_at IS NOT NULL
          AND grace_ends_at <= NOW()`,
    );
    return result.rowCount ?? 0;
  }

  async touchApiKeyLastUsed(
    apiKeyId: string,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `UPDATE project_api_keys SET last_used_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [apiKeyId],
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
   * Candidate lookup for verification. Narrows by public_key, then the service
   * performs the constant-time hash compare. Accepts active keys and rotated
   * keys whose rotation grace window is still open.
   */
  async findActiveApiKeyCandidatesByPrefix(
    publicKey: string,
    client?: PoolClient,
  ): Promise<Array<{
    apiKey: ProjectApiKeyRecord;
    project: Project;
    environmentName: string;
    environmentSlug: string;
  }>> {
    const db = client ?? this.db;
    const result = await db.query<ApiKeyRow & Record<string, unknown>>(
      `SELECT
         ${API_KEY_COLUMNS.split(",").map((column) => `k.${column.trim()}`).join(", ")},
         p.id AS p_id, p.org_id AS p_org_id, p.name AS p_name, p.slug AS p_slug,
          p.description AS p_description, p.status AS p_status,
          p.timezone AS p_timezone, p.tags AS p_tags, p.icon AS p_icon,
          p.metadata AS p_metadata, p.archived_at AS p_archived_at, p.deleted_at AS p_deleted_at,
         p.deleted_by AS p_deleted_by, p.created_at AS p_created_at, p.updated_at AS p_updated_at,
         p.version AS p_version,
         e.name AS env_name, e.slug AS env_slug
       FROM project_api_keys k
       INNER JOIN projects p ON p.id = k.project_id AND p.org_id = k.organization_id
       INNER JOIN project_environments e
         ON e.id = k.environment_id
        AND e.project_id = k.project_id
        AND e.organization_id = k.organization_id
        AND e.is_active = TRUE
        AND e.deleted_at IS NULL
       WHERE k.public_key = $1
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND k.deleted_at IS NULL
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND k.status = ANY($2::api_key_status[])
         AND (
           k.status = 'active'
           OR EXISTS (
             SELECT 1 FROM project_api_key_rotations r
              WHERE r.old_key_id = k.id
                AND r.state = 'grace_period'
                AND r.grace_ends_at IS NOT NULL
                AND r.grace_ends_at > NOW()
           )
         )`,
      [publicKey, [...AUTHENTICATING_STATUSES]],
    );

    return result.rows.map((row) => ({
      apiKey: this.mapApiKeyRecord(row as ApiKeyRow),
      project: this.mapProject(this.prefixedProjectRow(row)),
      environmentName: (row.env_name as string | null) ?? "default",
      environmentSlug: (row.env_slug as string | null) ?? "production",
    }));
  }

  // ── Usage analytics ─────────────────────────────────────────────────────────

  /**
   * Graph-ready series for one key. Hourly reads the minute-derived view,
   * daily reads the physical daily fact, and monthly reads the daily-derived
   * view, so no grain re-aggregates another grain's percentiles or duplicates.
   */
  async getApiKeyUsageSeries(
    apiKeyId: string,
    from: Date,
    to: Date,
    granularity: ApiKeyUsageGranularity,
    client?: PoolClient,
  ): Promise<ApiKeyUsageSeriesPoint[]> {
    const db = client ?? this.db;
    const source = USAGE_SOURCES[granularity];
    const result = await db.query<UsageRow>(
      `SELECT bucket::timestamptz AS bucket,
              COALESCE(SUM(request_count),0)::text AS request_count,
              COALESCE(SUM(accepted_event_count),0)::text AS accepted_event_count,
              COALESCE(SUM(error_event_count),0)::text AS error_event_count,
              COALESCE(SUM(ingestion_failure_count),0)::text AS ingestion_failure_count,
              COALESCE(SUM(accepted_bytes),0)::text AS accepted_bytes,
              COALESCE(SUM(rate_limited_request_count),0)::text AS rate_limited_request_count
         FROM ${source}
        WHERE api_key_id = $1 AND bucket >= $2 AND bucket <= $3
        GROUP BY bucket
        ORDER BY bucket ASC`,
      [apiKeyId, from, to],
    );

    return result.rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      requests: Number.parseInt(row.request_count, 10),
      acceptedEvents: Number.parseInt(row.accepted_event_count, 10),
      errorEvents: Number.parseInt(row.error_event_count, 10),
      ingestionFailures: Number.parseInt(row.ingestion_failure_count, 10),
      acceptedBytes: Number.parseInt(row.accepted_bytes, 10),
      rateLimitedRequests: Number.parseInt(row.rate_limited_request_count, 10),
    }));
  }

  // ── Mapping helpers ─────────────────────────────────────────────────────────

  private prefixedProjectRow(row: Record<string, unknown>): import("../core/project.repository.js").ProjectRow {
    return {
      id: row.p_id as string,
      public_id: row.p_public_id as string,
      org_id: row.p_org_id as string,
      name: row.p_name as string,
      slug: row.p_slug as string,
      description: row.p_description as string | null,
      status: row.p_status as ProjectStatus,
      timezone: row.p_timezone as string,
      tags: row.p_tags as string[],
      icon: row.p_icon as string | null,
      metadata: row.p_metadata as Record<string, unknown> | null,
      archived_at: row.p_archived_at as Date | null,
      deleted_at: row.p_deleted_at as Date | null,
      deleted_by: row.p_deleted_by as string | null,
      created_at: row.p_created_at as Date,
      updated_at: row.p_updated_at as Date,
      version: Number(row.p_version ?? 1),
    };
  }

  private mapProject(row: import("../core/project.repository.js").ProjectRow): Project {
    return {
      id: row.id,
      publicId: row.public_id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status,
      timezone: row.timezone,
      tags: row.tags ?? [],
      icon: row.icon,
      metadata: row.metadata ?? {},
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private mapRotation(row: RotationRow): ApiKeyRotation {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      oldKeyId: row.old_key_id,
      newKeyId: row.new_key_id,
      state: row.state,
      reason: row.reason,
      initiatedBy: row.initiated_by,
      initiatedAt: row.initiated_at,
      graceEndsAt: row.grace_ends_at,
      completedAt: row.completed_at,
    };
  }

  public mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      name: row.name,
      publicKey: row.public_key,
      secretHash: row.secret_hash ?? "",
      status: row.status,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdBy: row.created_by,
      rotatedFromKeyId: row.rotated_from_key_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  private mapApiKey(row: ApiKeyRow): ProjectApiKey {
    return this.publicShape(this.mapApiKeyRecord(row));
  }

  /** Strip the secret verifier before a credential leaves the repository. */
  public publicShape(record: ProjectApiKeyRecord | ProjectApiKey): ProjectApiKey {
    const shape = { ...record };
    delete (shape as Partial<ProjectApiKeyRecord>).secretHash;
    return shape as ProjectApiKey;
  }
}
