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
  projectSlug?: string | undefined;
  orgId: string;
  orgName?: string | undefined;
  orgSlug?: string | undefined;
  projectName: string;
  projectStatus: string;
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
  apiKeyId: string;
  apiKeyName: string;
  /**
   * Ingestion-side policy defaults. These are NOT credential columns: the API
   * key only selects a project/environment, so authorization, endpoint/event
   * scoping, and rate limits resolve from organization/platform configuration.
   */
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

  constructor(public readonly pool: Pool, telemetryPool: Pool = pool) {
    this.reader = new TelemetryReader(telemetryPool);
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
        p.slug as project_slug,
        p.org_id,
        p.name as project_name,
        p.status as project_status,
        o.name as org_name,
        o.slug as org_slug,
        k.id as key_id,
        k.name as api_key_name,
        k.environment_id,
        e.name as environment_name,
        e.slug as environment_slug,
        k.status as key_status,
        k.expires_at,
        k.secret_hash,
        latest_plan.tier AS plan_tier
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      LEFT JOIN organizations o ON o.id = p.org_id
      LEFT JOIN project_environments e ON e.id = k.environment_id
      LEFT JOIN LATERAL (
        SELECT pl.tier
        FROM organization_subscriptions s
        INNER JOIN plans pl
          ON pl.id = s.plan_id
         AND pl.deleted_at IS NULL
        WHERE s.organization_id = p.org_id
          AND s.status IN ('trialing', 'active', 'past_due')
          AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC
        LIMIT 1
      ) latest_plan ON TRUE
      WHERE k.public_key = $1
        AND p.deleted_at IS NULL
        AND k.deleted_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND (
          k.status = 'active'
          OR (
            k.status = 'rotated'
            AND EXISTS (
              SELECT 1 FROM project_api_key_rotations r
               WHERE r.old_key_id = k.id
                 AND r.state = 'grace_period'
                 AND r.grace_ends_at IS NOT NULL
                 AND r.grace_ends_at > NOW()
            )
        )
      )
      ORDER BY k.created_at DESC
    `,
      [publicKey],
    );

    for (const row of result.rows) {
      if (!constantTimeEqualHex(row.secret_hash as string, rawHash)) continue;
      if (row.project_status !== 'active') return null;

      return {
        projectId: row.project_id as string,
        projectSlug: (row.project_slug as string | undefined) ?? undefined,
        orgId: row.org_id as string,
        orgName: (row.org_name as string | undefined) ?? undefined,
        orgSlug: (row.org_slug as string | undefined) ?? undefined,
        projectName: row.project_name as string,
        projectStatus: row.project_status as string,
        environmentId: row.environment_id as string,
        environmentName: row.environment_name as string,
        environmentSlug: row.environment_slug as string,
        apiKeyId: row.key_id as string,
        apiKeyName: row.api_key_name as string,
        // A credential only proves identity. Ingestion authorization and rate
        // limits come from organization/platform configuration, so an
        // authenticated key resolves to the permissive ingestion defaults.
        keyType: 'ingest',
        rotationVersion: 1,
        isActive: true,
        status: row.key_status as string,
        expiresAt: row.expires_at as Date | null,
        permissions: ['ingest:write'],
        allowedEndpoints: ['*'],
        blockedEndpoints: [],
        allowedEventTypes: ['*'],
        allowedOrigins: [],
        allowedIps: [],
        allowedDomains: [],
        allowedSdks: [],
        rateLimitPerSecond: null,
        rateLimitPerMinute: null,
        rateLimitPerHour: null,
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
            SET last_used_at = NOW()
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
    environment?: string,
  ): Promise<EnrichedEvent[]> {
    return this.reader.getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents, environment);
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
