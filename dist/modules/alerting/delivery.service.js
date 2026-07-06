import { pool } from "../../config/database.js";
export class DeliveryService {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async enqueue(data) {
        // 6.2 DeliveryService -- Enqueue & Attempt
        // Insert into notification_deliveries with project_id.
        const res = await pool.query(`
      INSERT INTO notification_deliveries (
        organization_id, project_id, connector_id, route_id,
        severity, payload, recipients, correlation_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
      RETURNING id
      `, [
            data.organization_id,
            data.project_id,
            data.connector_id,
            data.route_id,
            data.severity,
            data.payload,
            data.recipients ? JSON.stringify(data.recipients) : null,
            data.correlation_id,
        ]);
        this.logger.info({
            orgId: data.organization_id,
            projectId: data.project_id,
            deliveryId: res.rows[0].id
        }, "Enqueued alert delivery");
        // The background worker (similar to existing batch processor) will read from `notification_deliveries`.
        // It will check if recipients is non-null to send individual messages or connector default channel.
        // Respect quiet_hours, retry logic etc.
    }
}
//# sourceMappingURL=delivery.service.js.map