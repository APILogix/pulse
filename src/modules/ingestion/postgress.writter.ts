/**
 * PostgresWriter — API key resolution + telemetry reads (delegates to TelemetryReader).
 * Persistence for the ingestion worker lives in TelemetryWriter, not here.
 */
import { type Pool } from 'pg';
import type {
  EnrichedEvent,
  ErrorEventListResult,
  ErrorEventRecord,
  NormalizedErrorEventListQuery,
} from './types.js';
import { TelemetryReader } from './pipeline/telemetry-reader.js';
import { extractApiKeyPrefix, hashApiKey, constantTimeEqualHex } from '../projects/shared/utils.js';

export interface ProjectAuthResult {
  projectId: string;
  orgId: string;
  projectName: string;
  projectStatus: string;
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
  apiKeyId: string;
  keyType: string;
  rotationVersion: number;
  isActive: boolean;
  status: string;
  expiresAt: Date | null;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowedEventTypes: string[];
  allowedOrigins: string[];
  allowedIps: string[];
  allowedDomains: string[];
  allowedSdks: string[];
  samplingRules: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  sdkConfig: Record<string, unknown>;
  rateLimitPerSecond: number | null;
  rateLimitPerMinute: number | null;
  rateLimitPerHour: number | null;
  /**
   * Raw billing plan tier (plans.tier) resolved via the organization's latest
   * live subscription. NULL when the org has no trialing/active/past_due
   * subscription — callers map it through normalizePlanTier().
   */
  planTier: string | null;
  /**
   * Optional org-wide ingest rate-limit overrides. No schema column carries
   * these today, so they are always NULL and the service falls back to the
   * INGESTION_ORG_RATE_LIMIT_* env defaults.
   */
  orgRateLimitPerSecond: number | null;
  orgRateLimitPerMinute: number | null;
}

export class PostgresWriter {
  private readonly reader: TelemetryReader;

  constructor(public readonly pool: Pool) {
    this.reader = new TelemetryReader(pool);
  }

  /**
   * Resolve an ingestion API key by extracting its public prefix, looking up
   * candidate rows, and comparing the SHA-256 secret hash in constant time.
   * Returns the full project/auth context needed by the gateway, including the
   * environment, scoping fields, and billing plan tier.
   */
  async resolveApiKey(rawKey: string): Promise<ProjectAuthResult | null> {
    const publicKey = extractApiKeyPrefix(rawKey);
    if (!publicKey) return null;

    const rawHash = hashApiKey(rawKey);

    const result = await this.pool.query(
      `
      SELECT
        p.id as project_id,
        p.org_id,
        p.name as project_name,
        p.status as project_status,
        k.id as key_id,
        k.environment_id,
        e.name as environment_name,
        e.slug as environment_slug,
        k.is_active,
        k.status as key_status,
        k.key_type,
        k.rotation_version,
        k.expires_at,
        k.secret_hash,
        k.permissions,
        k.allowed_endpoints,
        k.blocked_endpoints,
        k.allowed_event_types,
        k.allowed_origins,
        k.allowed_ips,
        k.allowed_domains,
        k.allowed_sdks,
        k.sampling_rules,
        k.feature_flags,
        k.sdk_config,
        COALESCE(k.rate_limit_per_second, e.rate_limit_per_second, p.rate_limit_per_second) AS rate_limit_per_second,
        COALESCE(k.rate_limit_per_minute, e.rate_limit_per_minute, p.rate_limit_per_minute) AS rate_limit_per_minute,
        COALESCE(k.rate_limit_per_hour, e.rate_limit_per_hour, p.rate_limit_per_hour) AS rate_limit_per_hour,
        pl.tier AS plan_tier
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      LEFT JOIN project_environments e ON e.id = k.environment_id
      LEFT JOIN organization_subscriptions s
        ON s.organization_id = p.org_id
       AND s.status IN ('trialing', 'active', 'past_due')
       AND s.deleted_at IS NULL
      LEFT JOIN plans pl
        ON pl.id = s.plan_id
       AND pl.deleted_at IS NULL
      WHERE k.public_key = $1
        AND p.deleted_at IS NULL
        AND k.deleted_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND (
          k.is_active = TRUE
          OR (k.status = 'rotated' AND k.grace_period_ends_at IS NOT NULL AND k.grace_period_ends_at > NOW())
        )
      ORDER BY s.created_at DESC NULLS LAST, k.created_at DESC
    `,
      [publicKey],
    );

    for (const row of result.rows) {
      if (!constantTimeEqualHex(row.secret_hash as string, rawHash)) continue;
      if (row.project_status !== 'active') return null;

      return {
        projectId: row.project_id as string,
        orgId: row.org_id as string,
        projectName: row.project_name as string,
        projectStatus: row.project_status as string,
        environmentId: row.environment_id as string,
        environmentName: row.environment_name as string,
        environmentSlug: row.environment_slug as string,
        apiKeyId: row.key_id as string,
        keyType: row.key_type as string,
        rotationVersion: Number(row.rotation_version ?? 1),
        isActive: row.is_active as boolean,
        status: row.key_status as string,
        expiresAt: row.expires_at as Date | null,
        permissions: (row.permissions as string[] | null) ?? [],
        allowedEndpoints: (row.allowed_endpoints as string[] | null) ?? [],
        blockedEndpoints: (row.blocked_endpoints as string[] | null) ?? [],
        allowedEventTypes: (row.allowed_event_types as string[] | null) ?? [],
        allowedOrigins: (row.allowed_origins as string[] | null) ?? [],
        allowedIps: (row.allowed_ips as string[] | null) ?? [],
        allowedDomains: (row.allowed_domains as string[] | null) ?? [],
        allowedSdks: (row.allowed_sdks as string[] | null) ?? [],
        samplingRules: (row.sampling_rules as Record<string, unknown> | null) ?? {},
        featureFlags: (row.feature_flags as Record<string, unknown> | null) ?? {},
        sdkConfig: (row.sdk_config as Record<string, unknown> | null) ?? {},
        rateLimitPerSecond: row.rate_limit_per_second as number | null,
        rateLimitPerMinute: row.rate_limit_per_minute as number | null,
        rateLimitPerHour: row.rate_limit_per_hour as number | null,
        planTier: row.plan_tier as string | null,
        orgRateLimitPerSecond: null,
        orgRateLimitPerMinute: null,
      };
    }

    return null;
  }

  /**
   * Billing context for a project (org + plan tier). Used by the admin replay
   * path, which has no API key to resolve through resolveApiKey().
   */
  async getProjectPlanContext(
    projectId: string,
  ): Promise<{ orgId: string; planTier: string | null } | null> {
    const result = await this.pool.query(
      `
      SELECT
        p.org_id,
        pl.tier AS plan_tier
      FROM projects p
      LEFT JOIN organization_subscriptions s
        ON s.organization_id = p.org_id
       AND s.status IN ('trialing', 'active', 'past_due')
       AND s.deleted_at IS NULL
      LEFT JOIN plans pl
        ON pl.id = s.plan_id
       AND pl.deleted_at IS NULL
      WHERE p.id = $1
        AND p.deleted_at IS NULL
      ORDER BY s.created_at DESC NULLS LAST
      LIMIT 1
    `,
      [projectId],
    );
    if (result.rows.length === 0) return null;
    return {
      orgId: result.rows[0].org_id,
      planTier: result.rows[0].plan_tier ?? null,
    };
  }

  async updateApiKeyLastUsed(apiKeyId: string): Promise<void> {
    await this.pool
      .query(
        `UPDATE project_api_keys
            SET last_used_at = NOW(),
                usage_count = usage_count + 1
          WHERE id = $1`,
        [apiKeyId],
      )
      .catch(() => {});
  }

  async listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult> {
    return this.reader.listErrorEvents(query);
  }

  async getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null> {
    return this.reader.getErrorEventById(errorId, projectId);
  }

  async getEventById(eventId: string, projectId: string): Promise<unknown> {
    return this.reader.getEventById(eventId, projectId);
  }

  async getEventsForReplay(
    projectId: string,
    startTime: string,
    endTime: string,
    eventTypes?: string[],
    maxEvents = 10_000,
  ): Promise<EnrichedEvent[]> {
    return this.reader.getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
