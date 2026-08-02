import { pool } from "../../../../config/database.js";
export class DeliveryLogRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async listDeliveries(organizationId, projectId, filters) {
        const conditions = ["d.organization_id = $1", "c.project_id = $2"];
        const params = [organizationId, projectId];
        if (filters.status) {
            params.push(filters.status);
            conditions.push(`d.status = $${params.length}`);
        }
        if (filters.severity) {
            params.push(filters.severity);
            conditions.push(`d.severity = $${params.length}`);
        }
        const where = conditions.join(" AND ");
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count
         FROM connector_deliveries d
         JOIN connector_configs c ON c.id = d.connector_id
        WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const rows = await this.db.query(`SELECT d.id, d.status, d.severity, d.attempts, d.delivery_latency_ms,
              d.created_at, d.error_message, d.payload_size_bytes, d.notification_type,
              c.name AS connector_name, c.provider AS connector_provider
         FROM connector_deliveries d
         JOIN connector_configs c ON c.id = d.connector_id
        WHERE ${where}
        ORDER BY d.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: rows.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    /** List permanently failed deliveries (the dead-letter queue) for a project. */
    async listDeadLetters(organizationId, projectId, filters) {
        return this.listDeliveries(organizationId, projectId, {
            status: "failed",
            limit: filters.limit,
            offset: filters.offset,
        });
    }
    /**
     * Reset a single failed delivery back to `retrying` so the retry worker
     * re-dispatches it. Scoped to the project via the connector join.
     */
    async reprocessDeadLetter(organizationId, projectId, deliveryId) {
        const res = await this.db.query(`UPDATE connector_deliveries d
          SET status = 'retrying',
              attempts = 0,
              retry_count = 0,
              next_retry_at = NOW(),
              failed_at = NULL,
              error_message = NULL,
              error_details = NULL,
              updated_at = NOW()
        WHERE d.id = $1
          AND d.organization_id = $2
          AND d.status = 'failed'
          AND d.connector_id IN (
            SELECT id FROM connector_configs WHERE project_id = $3
          )`, [deliveryId, organizationId, projectId]);
        return (res.rowCount ?? 0) > 0;
    }
    /** Reset every failed delivery for a project back to `retrying`. */
    async reprocessAll(organizationId, projectId) {
        const res = await this.db.query(`UPDATE connector_deliveries d
          SET status = 'retrying',
              attempts = 0,
              retry_count = 0,
              next_retry_at = NOW(),
              failed_at = NULL,
              error_message = NULL,
              error_details = NULL,
              updated_at = NOW()
        WHERE d.organization_id = $1
          AND d.status = 'failed'
          AND d.connector_id IN (
            SELECT id FROM connector_configs WHERE project_id = $2
          )`, [organizationId, projectId]);
        return res.rowCount ?? 0;
    }
    /** Soft-discard a single failed delivery by moving it to `cancelled`. */
    async discardDeadLetter(organizationId, projectId, deliveryId) {
        const res = await this.db.query(`UPDATE connector_deliveries d
          SET status = 'cancelled', updated_at = NOW()
        WHERE d.id = $1
          AND d.organization_id = $2
          AND d.status = 'failed'
          AND d.connector_id IN (
            SELECT id FROM connector_configs WHERE project_id = $3
          )`, [deliveryId, organizationId, projectId]);
        return (res.rowCount ?? 0) > 0;
    }
    /** Soft-discard every failed delivery for a project. */
    async purgeQueue(organizationId, projectId) {
        const res = await this.db.query(`UPDATE connector_deliveries d
          SET status = 'cancelled', updated_at = NOW()
        WHERE d.organization_id = $1
          AND d.status = 'failed'
          AND d.connector_id IN (
            SELECT id FROM connector_configs WHERE project_id = $2
          )`, [organizationId, projectId]);
        return res.rowCount ?? 0;
    }
}
//# sourceMappingURL=delivery-log.repository.js.map