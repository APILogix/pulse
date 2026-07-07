import { pool } from '../../config/database.js';
export class DeliveryRepository {
    db = pool;
    async createDelivery(input) {
        const payloadJson = JSON.stringify(input.payload);
        const r = await this.db.query(`INSERT INTO notification_deliveries
         (organization_id, project_id, connector_id, route_id, notification_type, severity,
          payload, payload_size_bytes, recipients, status, max_attempts, correlation_id, parent_delivery_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING *`, [
            input.organizationId, input.projectId, input.connectorId, input.routeId, input.notificationType,
            input.severity, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
            input.recipients ? JSON.stringify(input.recipients) : null,
            input.status, input.maxAttempts, input.correlationId, input.parentDeliveryId,
        ]);
        return r.rows[0];
    }
    async listDeliveries(organizationId, projectId, filters) {
        const conditions = ['organization_id=$1', 'project_id=$2'];
        const params = [organizationId, projectId];
        if (filters.connectorId) {
            params.push(filters.connectorId);
            conditions.push(`connector_id=$${params.length}`);
        }
        if (filters.status) {
            params.push(filters.status);
            conditions.push(`status=$${params.length}`);
        }
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const r = await this.db.query(`SELECT * FROM notification_deliveries WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    /** Claim due retry rows for processing (SKIP LOCKED for safe concurrency). */
    async claimRetryableDeliveries(limit) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query(`SELECT * FROM notification_deliveries
         WHERE status='retrying' AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`, [limit]);
            await client.query('COMMIT');
            return r.rows;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async markDeliverySent(id, update) {
        await this.db.query(`UPDATE notification_deliveries
       SET status='sent', attempts=attempts+1, sent_at=NOW(),
           external_message_id=$2, response_status_code=$3, response_body=$4, delivery_latency_ms=$5
       WHERE id=$1`, [id, update.externalMessageId, update.responseStatusCode, update.responseBody, update.latencyMs]);
    }
    async markDeliveryRetrying(id, nextRetryAt, errorMessage) {
        await this.db.query(`UPDATE notification_deliveries
       SET status='retrying', attempts=attempts+1, retry_count=retry_count+1,
           next_retry_at=$2, error_message=$3
       WHERE id=$1`, [id, nextRetryAt, errorMessage.slice(0, 2000)]);
    }
    async markDeliveryFailed(id, errorMessage, errorDetails) {
        await this.db.query(`UPDATE notification_deliveries
       SET status='failed', attempts=attempts+1, failed_at=NOW(),
           error_message=$2, error_details=$3
       WHERE id=$1`, [id, errorMessage.slice(0, 2000), errorDetails ? JSON.stringify(errorDetails) : null]);
    }
}
//# sourceMappingURL=delivery.repository.js.map