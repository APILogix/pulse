/**
 * PostgresWriter — API key resolution + telemetry reads (delegates to TelemetryReader).
 * Persistence for the ingestion worker lives in TelemetryWriter, not here.
 */
import {} from 'pg';
import { TelemetryReader } from './pipeline/telemetry-reader.js';
export class PostgresWriter {
    pool;
    reader;
    constructor(pool) {
        this.pool = pool;
        this.reader = new TelemetryReader(pool);
    }
    async getProjectByApiKeyHash(keyHash) {
        const result = await this.pool.query(`
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
        COALESCE(k.rate_limit_per_minute, p.rate_limit_per_minute) AS rate_limit_per_minute
      FROM project_api_keys k
      INNER JOIN projects p ON p.id = k.project_id
      WHERE k.key_hash = $1
        AND (
          k.is_active = TRUE
          OR (k.status = 'rotated' AND k.grace_period_ends_at IS NOT NULL AND k.grace_period_ends_at > NOW())
        )
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND p.status = 'active'
        AND p.deleted_at IS NULL
      LIMIT 1
    `, [keyHash]);
        if (result.rows.length === 0)
            return null;
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
        };
    }
    async updateApiKeyLastUsed(apiKeyId) {
        await this.pool
            .query(`UPDATE project_api_keys
            SET last_used_at = NOW(),
                usage_count = usage_count + 1
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
    async getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents = 10_000) {
        return this.reader.getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents);
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