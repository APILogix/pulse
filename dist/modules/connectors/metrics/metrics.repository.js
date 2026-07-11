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
             WHEN consecutive_failures + 1 >= failure_threshold THEN 'error'::connector_status
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
        await this.db.query(`UPDATE connector_configs SET last_health_check_at=NOW() WHERE id=$1`, [connectorId]);
        return r.rows[0];
    }
}
//# sourceMappingURL=metrics.repository.js.map