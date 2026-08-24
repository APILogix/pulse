/**
 * PostgresWriter — API key resolution + telemetry reads (delegates to TelemetryReader).
 * Persistence for the ingestion worker lives in TelemetryWriter, not here.
 */
import {} from 'pg';
import { TelemetryReader } from './pipeline/telemetry-reader.js';
import { extractApiKeyPrefix, hashApiKey, constantTimeEqualHex } from '../projects/shared/utils.js';
export class PostgresWriter {
    pool;
    reader;
    constructor(pool, telemetryPool = pool) {
        this.pool = pool;
        this.reader = new TelemetryReader(telemetryPool);
    }
    /**
     * Resolve an ingestion API key by extracting its public prefix, looking up
     * candidate rows, and comparing the SHA-256 secret hash in constant time.
     * Returns the full project/auth context needed by the gateway, including the
     * environment, scoping fields, and billing plan tier.
     */
    async resolveApiKey(rawKey) {
        const publicKey = extractApiKeyPrefix(rawKey);
        if (!publicKey)
            return null;
        const rawHash = hashApiKey(rawKey);
        const result = await this.pool.query(`
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
        pl.tier AS plan_tier
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      LEFT JOIN organizations o ON o.id = p.org_id
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
      ORDER BY s.created_at DESC NULLS LAST, k.created_at DESC
    `, [publicKey]);
        for (const row of result.rows) {
            if (!constantTimeEqualHex(row.secret_hash, rawHash))
                continue;
            if (row.project_status !== 'active')
                return null;
            return {
                projectId: row.project_id,
                projectSlug: row.project_slug ?? undefined,
                orgId: row.org_id,
                orgName: row.org_name ?? undefined,
                orgSlug: row.org_slug ?? undefined,
                projectName: row.project_name,
                projectStatus: row.project_status,
                environmentId: row.environment_id,
                environmentName: row.environment_name,
                environmentSlug: row.environment_slug,
                apiKeyId: row.key_id,
                apiKeyName: row.api_key_name,
                // A credential only proves identity. Ingestion authorization and rate
                // limits come from organization/platform configuration, so an
                // authenticated key resolves to the permissive ingestion defaults.
                keyType: 'ingest',
                rotationVersion: 1,
                isActive: true,
                status: row.key_status,
                expiresAt: row.expires_at,
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
                planTier: row.plan_tier,
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
    async getProjectPlanContext(projectId) {
        const result = await this.pool.query(`
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
    `, [projectId]);
        if (result.rows.length === 0)
            return null;
        return {
            orgId: result.rows[0].org_id,
            planTier: result.rows[0].plan_tier ?? null,
        };
    }
    async updateApiKeyLastUsed(apiKeyId) {
        await this.pool
            .query(`UPDATE project_api_keys
            SET last_used_at = NOW()
          WHERE id = $1`, [apiKeyId])
            .catch(() => { });
    }
    async listErrorEvents(query) {
        return this.reader.listErrorEvents(query);
    }
    async getErrorEventById(errorId, projectId) {
        return this.reader.getErrorEventById(errorId, projectId);
    }
    async getEventById(eventId, projectId) {
        return this.reader.getEventById(eventId, projectId);
    }
    async getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents = 10_000, environment) {
        return this.reader.getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents, environment);
    }
    async healthCheck() {
        try {
            await this.pool.query('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=postgress.writter.js.map