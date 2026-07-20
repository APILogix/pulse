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

export interface ProjectAuthResult {
  projectId: string;
  orgId: string;
  projectName: string;
  projectStatus: string;
  environment: string;
  apiKeyId: string;
  isActive: boolean;
  expiresAt: Date | null;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  rateLimitPerSecond: number | null;
  rateLimitPerMinute: number | null;
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

  async getProjectByApiKeyHash(keyHash: string): Promise<ProjectAuthResult | null> {
    const result = await this.pool.query(
      `
      SELECT
        p.id as project_id,
        p.org_id,
        p.name as project_name,
        p.status as project_status,
        k.environment,
        k.id as key_id,
        k.is_active,
        k.expires_at,
        k.permissions,
        k.allowed_endpoints,
        k.blocked_endpoints,
        COALESCE(k.rate_limit_per_second, p.rate_limit_per_second) AS rate_limit_per_second,
        COALESCE(k.rate_limit_per_minute, p.rate_limit_per_minute) AS rate_limit_per_minute,
        pl.tier AS plan_tier
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      LEFT JOIN organization_subscriptions s
        ON s.organization_id = p.org_id
       AND s.status IN ('trialing', 'active', 'past_due')
       AND s.deleted_at IS NULL
      LEFT JOIN plans pl
        ON pl.id = s.plan_id
       AND pl.deleted_at IS NULL
      WHERE k.key_hash = $1
        AND (
          k.is_active = TRUE
          OR (k.status = 'rotated' AND k.grace_period_ends_at IS NOT NULL AND k.grace_period_ends_at > NOW())
        )
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND p.status = 'active'
        AND p.deleted_at IS NULL
      ORDER BY s.created_at DESC NULLS LAST
      LIMIT 1
    `,
      [keyHash],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      projectId: row.project_id,
      orgId: row.org_id,
      projectName: row.project_name,
      projectStatus: row.project_status,
      environment: row.environment,
      apiKeyId: row.key_id,
      isActive: row.is_active,
      expiresAt: row.expires_at,
      permissions: row.permissions ?? [],
      allowedEndpoints: row.allowed_endpoints ?? [],
      blockedEndpoints: row.blocked_endpoints ?? [],
      rateLimitPerSecond: row.rate_limit_per_second ?? null,
      rateLimitPerMinute: row.rate_limit_per_minute ?? null,
      planTier: row.plan_tier ?? null,
      orgRateLimitPerSecond: null,
      orgRateLimitPerMinute: null,
    };
  }

  /**
   * Billing context for a project (org + plan tier). Used by the admin replay
   * path, which has no API key to resolve through getProjectByApiKeyHash().
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
