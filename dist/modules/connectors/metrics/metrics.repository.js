import { pool } from '../../../config/database.js';
import { ConnectorConflictError, ConnectorNotFoundError, } from '../types.js';
export class ConnectorMetricsRepository {
    db = pool;
    // ── Connector CRUD ─────────────────────────────────────────────────────
    // ── Health / failure bookkeeping ───────────────────────────────────────
    async recordSuccess(connectorId) {
        await this.db.query(`UPDATE connector_configs
       SET consecutive_failures=0, last_successful_delivery_at=NOW(),
           status = CASE WHEN status='error' THEN 'active' ELSE status END
       WHERE id=$1`, [connectorId]);
    }
    /** Increment failures; flip to 'error' once the threshold is crossed. */
    async recordFailure(connectorId) {
        const r = await this.db.query(`UPDATE connector_configs
       SET consecutive_failures = consecutive_failures + 1,
           status = CASE
             WHEN consecutive_failures + 1 >= failure_threshold THEN 'error'
             ELSE status
           END
       WHERE id=$1
       RETURNING consecutive_failures, failure_threshold, status`, [connectorId]);
        const row = r.rows[0];
        return {
            consecutiveFailures: row?.consecutive_failures ?? 0,
            tripped: row?.status === 'error',
        };
    }
    async insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details) {
        const r = await this.db.query(`INSERT INTO connector_health_checks (connector_id, status, response_time_ms, error_message, details)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, connector_id, status, response_time_ms, error_message, details, checked_at`, [connectorId, state, responseTimeMs, errorMessage, JSON.stringify(details)]);
        await this.db.query(`UPDATE connector_configs
       SET last_health_check_at=NOW(),
           consecutive_failures = CASE
             WHEN $2='healthy' THEN 0
             WHEN status IN ('disabled','inactive','revoked') THEN consecutive_failures
             ELSE consecutive_failures + 1
           END,
           status = CASE
             WHEN status IN ('disabled','inactive','revoked') THEN status
             WHEN $2='healthy' THEN 'active'
             WHEN $2='degraded' THEN 'degraded'
             ELSE 'error'
           END
       WHERE id=$1`, [connectorId, state]);
        return r.rows[0];
    }
    async listHealthChecks(organizationId, connectorId, filters) {
        const count = await this.db.query(`SELECT COUNT(*)::text AS count
       FROM connector_health_checks h
       JOIN connector_configs c ON c.id=h.connector_id
       WHERE h.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL`, [connectorId, organizationId]);
        const data = await this.db.query(`SELECT h.id, h.connector_id, h.status, h.response_time_ms, h.error_message, h.details, h.checked_at
       FROM connector_health_checks h
       JOIN connector_configs c ON c.id=h.connector_id
       WHERE h.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL
       ORDER BY h.checked_at DESC
       LIMIT $3 OFFSET $4`, [connectorId, organizationId, filters.limit, filters.offset]);
        return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
    }
    async insertTestRun(input) {
        await this.db.query(`INSERT INTO connector_test_runs
         (connector_id, triggered_by, status, response, duration_ms)
       VALUES ($1,$2,$3,$4,$5)`, [
            input.connectorId,
            input.triggeredBy,
            input.status,
            input.response ? JSON.stringify(input.response) : null,
            input.durationMs,
        ]);
    }
    async listTestRuns(organizationId, connectorId, filters) {
        const count = await this.db.query(`SELECT COUNT(*)::text AS count
       FROM connector_test_runs t
       JOIN connector_configs c ON c.id=t.connector_id
       WHERE t.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL`, [connectorId, organizationId]);
        const data = await this.db.query(`SELECT t.id, t.connector_id, t.triggered_by, t.status, t.response, t.duration_ms, t.created_at
       FROM connector_test_runs t
       JOIN connector_configs c ON c.id=t.connector_id
       WHERE t.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT $3 OFFSET $4`, [connectorId, organizationId, filters.limit, filters.offset]);
        return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
    }
}
//# sourceMappingURL=metrics.repository.js.map