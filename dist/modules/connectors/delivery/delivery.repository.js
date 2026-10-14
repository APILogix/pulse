import { pool } from '../../../config/database.js';
import { ConnectorConflictError, ConnectorNotFoundError, } from '../types.js';
export const DELIVERY_COLUMNS = `
  id, organization_id, connector_id, route_id, notification_type, severity,
  payload, payload_size_bytes, status, attempts, max_attempts, scheduled_at,
  sent_at, delivered_at, failed_at, external_message_id, response_body,
  response_status_code, error_message, error_details, next_retry_at,
  retry_count, delivery_latency_ms, correlation_id, parent_delivery_id,
  created_at, updated_at
`;
export class DeliveryRepository {
    db;
    /**
     * ADR-0006: pools are injected explicitly. Reads/writes the LEGACY connector
     * delivery tables and stays on the primary pool until the L9 view swap.
     */
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Connector CRUD ─────────────────────────────────────────────────────
    // ── Health / failure bookkeeping ───────────────────────────────────────
    // ── Deliveries ─────────────────────────────────────────────────────────
    async insertDelivery(input) {
        const payloadJson = JSON.stringify(input.payload);
        const r = await this.db.query(`INSERT INTO connector_deliveries
         (organization_id, connector_id, route_id, notification_type, severity,
          payload, payload_size_bytes, status, max_attempts, correlation_id, parent_delivery_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${DELIVERY_COLUMNS}`, [
            input.organizationId, input.connectorId, input.routeId, input.notificationType,
            input.severity, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
            input.status, input.maxAttempts, input.correlationId, input.parentDeliveryId,
        ]);
        return r.rows[0];
    }
    async insertDeliveryIdempotent(input) {
        return this.withTransaction(async (client) => {
            await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [input.connectorId, input.correlationId]);
            const existing = await client.query(`SELECT ${DELIVERY_COLUMNS} FROM connector_deliveries
         WHERE connector_id = $1 AND correlation_id = $2
           AND created_at > now() - interval '24 hours'
         LIMIT 1`, [input.connectorId, input.correlationId]);
            if (existing.rows.length > 0) {
                return { row: existing.rows[0], existed: true };
            }
            const payloadJson = JSON.stringify(input.payload);
            const r = await client.query(`INSERT INTO connector_deliveries
           (organization_id, connector_id, route_id, notification_type, severity,
            payload, payload_size_bytes, status, max_attempts, correlation_id, parent_delivery_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${DELIVERY_COLUMNS}`, [
                input.organizationId, input.connectorId, input.routeId, input.notificationType,
                input.severity, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
                input.status, input.maxAttempts, input.correlationId, input.parentDeliveryId,
            ]);
            return { row: r.rows[0], existed: false };
        });
    }
    async markDeliverySent(id, update) {
        await this.withTransaction(async (client) => {
            const updated = await client.query(`UPDATE connector_deliveries
         SET status='sent', attempts=attempts+1, sent_at=NOW(), updated_at=NOW(),
             external_message_id=$2, response_status_code=$3, response_body=$4::text,
             provider_response=$4::jsonb, http_status=$3, duration_ms=$5, delivery_latency_ms=$5
         WHERE id=$1
         RETURNING ${DELIVERY_COLUMNS}`, [
                id,
                update.externalMessageId,
                update.responseStatusCode,
                update.responseBody ? JSON.stringify({ body: update.responseBody }) : null,
                update.latencyMs,
            ]);
            const row = updated.rows[0];
            if (row) {
                await this.insertAttempt(client, row, {
                    status: 'sent',
                    httpStatus: update.responseStatusCode,
                    response: update.responseBody ? { body: update.responseBody } : null,
                    durationMs: update.latencyMs,
                });
            }
        });
    }
    async markDeliveryRetrying(id, nextRetryAt, errorMessage) {
        await this.withTransaction(async (client) => {
            const updated = await client.query(`UPDATE connector_deliveries
         SET status='retrying', attempts=attempts+1, retry_count=retry_count+1,
             next_retry_at=$2, error_message=$3, updated_at=NOW()
         WHERE id=$1
         RETURNING ${DELIVERY_COLUMNS}`, [id, nextRetryAt, errorMessage.slice(0, 2000)]);
            const row = updated.rows[0];
            if (row) {
                await this.insertAttempt(client, row, {
                    status: 'retrying',
                    errorCode: 'retry_scheduled',
                    errorMessage,
                    response: null,
                    durationMs: null,
                });
            }
        });
    }
    async markDeliveryFailed(id, errorMessage, errorDetails) {
        await this.withTransaction(async (client) => {
            const updated = await client.query(`UPDATE connector_deliveries
         SET status='failed', attempts=attempts+1, failed_at=NOW(), updated_at=NOW(),
             error_message=$2, error_details=$3
         WHERE id=$1
         RETURNING ${DELIVERY_COLUMNS}`, [id, errorMessage.slice(0, 2000), errorDetails ? JSON.stringify(errorDetails) : null]);
            const row = updated.rows[0];
            if (row) {
                await this.insertAttempt(client, row, {
                    status: 'failed',
                    errorCode: typeof errorDetails?.category === 'string' ? errorDetails.category : null,
                    errorMessage,
                    response: errorDetails,
                    durationMs: null,
                });
            }
        });
    }
    /** Claim due retry rows for processing (SKIP LOCKED for safe concurrency). */
    async claimRetryableDeliveries(limit) {
        return this.withTransaction(async (client) => {
            await client.query(`UPDATE connector_deliveries
         SET status = 'retrying',
             next_retry_at = now(),
             error_message = coalesce(error_message, 'Recovered from stale pending'),
             updated_at = now()
         WHERE (id, created_at) IN (
           SELECT id, created_at FROM connector_deliveries
           WHERE status = 'pending' AND created_at < now() - interval '5 minutes'
           ORDER BY created_at ASC
           LIMIT 50
           FOR UPDATE SKIP LOCKED
         )`);
            const r = await client.query(`SELECT ${DELIVERY_COLUMNS} FROM connector_deliveries
         WHERE status='retrying' AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`, [limit]);
            return r.rows;
        });
    }
    async listDeliveries(organizationId, filters) {
        const conditions = ['organization_id=$1'];
        const params = [organizationId];
        if (filters.connectorId) {
            params.push(filters.connectorId);
            conditions.push(`connector_id=$${params.length}`);
        }
        if (filters.status) {
            params.push(filters.status);
            conditions.push(`status=$${params.length}`);
        }
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM connector_deliveries WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const r = await this.db.query(`SELECT ${DELIVERY_COLUMNS} FROM connector_deliveries WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getDelivery(organizationId, id) {
        const r = await this.db.query(`SELECT ${DELIVERY_COLUMNS} FROM connector_deliveries
       WHERE id=$1 AND organization_id=$2`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    async findDeliveryByDedupKey(connectorId, dedupKey, windowMinutes) {
        const r = await this.db.query(`SELECT ${DELIVERY_COLUMNS} FROM connector_deliveries
       WHERE connector_id = $1
         AND payload->>'dedupKey' = $2
         AND status = 'sent'
         AND created_at > now() - ($3 || ' minutes')::interval
       LIMIT 1`, [connectorId, dedupKey, windowMinutes]);
        return r.rows[0] ?? null;
    }
    async consumeRateLimitToken(connectorId, limit, windowSeconds) {
        return this.withTransaction(async (client) => {
            await client.query(`INSERT INTO connector_rate_buckets (connector_id, window_start, window_seconds, consumed)
         VALUES ($1, NOW(), $2, 0)
         ON CONFLICT (connector_id) DO NOTHING`, [connectorId, windowSeconds]);
            const locked = await client.query(`SELECT window_start, window_seconds, consumed
           FROM connector_rate_buckets
          WHERE connector_id = $1
          FOR UPDATE`, [connectorId]);
            const bucket = locked.rows[0];
            if (!bucket)
                return { allowed: true, retryAfterMs: 0 };
            const nowMs = Date.now();
            const bucketWindowMs = bucket.window_seconds * 1000;
            const expired = nowMs - new Date(bucket.window_start).getTime() >= bucketWindowMs;
            const windowChanged = bucket.window_seconds !== windowSeconds;
            if (expired || windowChanged) {
                await client.query(`UPDATE connector_rate_buckets
              SET window_start = NOW(),
                  window_seconds = $2,
                  consumed = 1
            WHERE connector_id = $1`, [connectorId, windowSeconds]);
                return { allowed: true, retryAfterMs: 0 };
            }
            if (bucket.consumed >= limit) {
                const retryAfterMs = Math.max(250, new Date(bucket.window_start).getTime() + bucketWindowMs - nowMs);
                return { allowed: false, retryAfterMs };
            }
            await client.query(`UPDATE connector_rate_buckets
            SET consumed = consumed + 1
          WHERE connector_id = $1`, [connectorId]);
            return { allowed: true, retryAfterMs: 0 };
        });
    }
    async circuitAllows(connectorId, resetTimeoutMs) {
        return this.withTransaction(async (client) => {
            await client.query(`INSERT INTO connector_circuit_state (connector_id, state, consecutive_failures)
         VALUES ($1, 'closed', 0)
         ON CONFLICT (connector_id) DO NOTHING`, [connectorId]);
            const r = await client.query(`SELECT state, opened_at, half_open_at
           FROM connector_circuit_state
          WHERE connector_id = $1
          FOR UPDATE`, [connectorId]);
            const state = r.rows[0];
            if (!state || state.state === 'closed')
                return true;
            const nowMs = Date.now();
            if (state.state === 'open') {
                const openedAtMs = state.opened_at ? new Date(state.opened_at).getTime() : 0;
                if (nowMs - openedAtMs >= resetTimeoutMs) {
                    await client.query(`UPDATE connector_circuit_state
                SET state = 'half_open',
                    half_open_at = NOW()
              WHERE connector_id = $1`, [connectorId]);
                    return true;
                }
                return false;
            }
            const halfOpenAtMs = state.half_open_at ? new Date(state.half_open_at).getTime() : 0;
            if (nowMs - halfOpenAtMs >= resetTimeoutMs) {
                await client.query(`UPDATE connector_circuit_state
              SET half_open_at = NOW()
            WHERE connector_id = $1`, [connectorId]);
                return true;
            }
            return false;
        });
    }
    async recordCircuitSuccess(connectorId) {
        await this.db.query(`INSERT INTO connector_circuit_state (
         connector_id, state, consecutive_failures, opened_at, half_open_at, last_success_at
       )
       VALUES ($1, 'closed', 0, NULL, NULL, NOW())
       ON CONFLICT (connector_id) DO UPDATE SET
         state = 'closed',
         consecutive_failures = 0,
         opened_at = NULL,
         half_open_at = NULL,
         last_success_at = NOW()`, [connectorId]);
    }
    async recordCircuitFailure(connectorId, failureThreshold) {
        const result = await this.db.query(`INSERT INTO connector_circuit_state (
         connector_id, state, consecutive_failures, opened_at, half_open_at, last_failure_at
       )
       VALUES (
         $1,
         CASE WHEN $2 <= 1 THEN 'open' ELSE 'closed' END,
         1,
         CASE WHEN $2 <= 1 THEN NOW() ELSE NULL END,
         NULL,
         NOW()
       )
       ON CONFLICT (connector_id) DO UPDATE SET
         consecutive_failures = connector_circuit_state.consecutive_failures + 1,
         state = CASE
           WHEN connector_circuit_state.state = 'half_open'
             OR connector_circuit_state.consecutive_failures + 1 >= $2 THEN 'open'
           ELSE connector_circuit_state.state
         END,
         opened_at = CASE
           WHEN connector_circuit_state.state = 'half_open'
             OR connector_circuit_state.consecutive_failures + 1 >= $2 THEN NOW()
           ELSE connector_circuit_state.opened_at
         END,
         half_open_at = CASE
           WHEN connector_circuit_state.state = 'half_open'
             OR connector_circuit_state.consecutive_failures + 1 >= $2 THEN NULL
           ELSE connector_circuit_state.half_open_at
         END,
         last_failure_at = NOW()
       RETURNING state`, [connectorId, failureThreshold]);
        return result.rows[0]?.state ?? 'closed';
    }
    async recordSuccessfulDeliveryUsage(organizationId, projectId, connectorType) {
        const email = connectorType === 'email' ? 1 : 0;
        const slack = connectorType === 'slack' ? 1 : 0;
        const sms = connectorType === 'sms' ? 1 : 0;
        const webhook = connectorType === 'webhook' ? 1 : 0;
        await this.withTransaction(async (client) => {
            await client.query(`UPDATE organization_usage_current_period
            SET alert_notifications_used = alert_notifications_used + 1,
                connector_sends_used = connector_sends_used + 1,
                email_sends_used = email_sends_used + $2,
                slack_sends_used = slack_sends_used + $3,
                sms_sends_used = sms_sends_used + $4,
                webhook_sends_used = webhook_sends_used + $5,
                last_alert_notification_at = NOW(),
                last_connector_send_at = NOW()
          WHERE organization_id = $1`, [organizationId, email, slack, sms, webhook]);
            if (projectId) {
                await client.query(`INSERT INTO usage_daily_counters (
             id, organization_id, project_id, usage_date,
             alert_notifications_count, connector_sends_count,
             email_sends_count, slack_sends_count, sms_sends_count, webhook_sends_count,
             created_at, updated_at
           ) VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, 1, 1, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (organization_id, project_id, usage_date)
           DO UPDATE SET
             alert_notifications_count = usage_daily_counters.alert_notifications_count + 1,
             connector_sends_count = usage_daily_counters.connector_sends_count + 1,
             email_sends_count = usage_daily_counters.email_sends_count + EXCLUDED.email_sends_count,
             slack_sends_count = usage_daily_counters.slack_sends_count + EXCLUDED.slack_sends_count,
             sms_sends_count = usage_daily_counters.sms_sends_count + EXCLUDED.sms_sends_count,
             webhook_sends_count = usage_daily_counters.webhook_sends_count + EXCLUDED.webhook_sends_count,
             updated_at = NOW()`, [organizationId, projectId, email, slack, sms, webhook]);
                return;
            }
            const updated = await client.query(`UPDATE usage_daily_counters
            SET alert_notifications_count = alert_notifications_count + 1,
                connector_sends_count = connector_sends_count + 1,
                email_sends_count = email_sends_count + $2,
                slack_sends_count = slack_sends_count + $3,
                sms_sends_count = sms_sends_count + $4,
                webhook_sends_count = webhook_sends_count + $5,
                updated_at = NOW()
          WHERE organization_id = $1
            AND project_id IS NULL
            AND usage_date = CURRENT_DATE`, [organizationId, email, slack, sms, webhook]);
            if ((updated.rowCount ?? 0) === 0) {
                await client.query(`INSERT INTO usage_daily_counters (
             id, organization_id, project_id, usage_date,
             alert_notifications_count, connector_sends_count,
             email_sends_count, slack_sends_count, sms_sends_count, webhook_sends_count,
             created_at, updated_at
           ) VALUES (gen_random_uuid(), $1, NULL, CURRENT_DATE, 1, 1, $2, $3, $4, $5, NOW(), NOW())`, [organizationId, email, slack, sms, webhook]);
            }
        });
    }
    async listAttempts(organizationId, connectorId, deliveryId, filters) {
        const count = await this.db.query(`SELECT COUNT(*)::text AS count
       FROM connector_delivery_attempts a
       JOIN connector_deliveries d ON d.id=a.delivery_id AND d.created_at=a.delivery_created_at
       WHERE a.delivery_id=$1 AND d.organization_id=$2 AND d.connector_id=$3`, [deliveryId, organizationId, connectorId]);
        const rows = await this.db.query(`SELECT a.id, a.delivery_id, a.delivery_created_at, a.attempt_number, a.status,
              a.http_status, a.error_code, a.error_message, a.response, a.duration_ms, a.attempted_at
       FROM connector_delivery_attempts a
       JOIN connector_deliveries d ON d.id=a.delivery_id AND d.created_at=a.delivery_created_at
       WHERE a.delivery_id=$1 AND d.organization_id=$2 AND d.connector_id=$3
       ORDER BY a.attempted_at DESC
       LIMIT $4 OFFSET $5`, [deliveryId, organizationId, connectorId, filters.limit, filters.offset]);
        return { data: rows.rows, total: Number(count.rows[0]?.count ?? 0) };
    }
    async retryDelivery(organizationId, id) {
        const r = await this.db.query(`UPDATE connector_deliveries
       SET status='retrying',
           attempts=0,
           retry_count=0,
           next_retry_at=NOW(),
           failed_at=NULL,
           error_message=NULL,
           error_details=NULL,
           updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND status IN ('failed','retrying')
       RETURNING ${DELIVERY_COLUMNS}`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    // ── Dead letter ────────────────────────────────────────────────────────
    async insertDeadLetter(input) {
        await this.db.query(`INSERT INTO connector_audit_logs
         (organization_id, connector_id, action, actor_type, changes_summary, new_state)
       VALUES ($1,$2,'delivery.dead_lettered','system',$3,$4)`, [
            input.organizationId,
            input.connectorId,
            JSON.stringify({
                originalDeliveryId: input.originalDeliveryId,
                failureReason: input.failureReason.slice(0, 4000),
                failureCategory: input.failureCategory,
                retryAttempts: input.retryAttempts,
            }),
            JSON.stringify({
                errorStack: input.errorStack,
                originalPayload: input.originalPayload,
            }),
        ]);
    }
    async getDlqGrowth(windowMinutes) {
        const r = await this.db.query(`SELECT COUNT(*)::text AS count
       FROM connector_audit_logs
       WHERE action = 'delivery.dead_lettered'
         AND created_at > NOW() - ($1 || ' minutes')::interval`, [windowMinutes]);
        return Number(r.rows[0]?.count ?? 0);
    }
    async insertAttempt(client, delivery, input) {
        await client.query(`INSERT INTO connector_delivery_attempts
         (delivery_id, delivery_created_at, attempt_number, status, http_status,
          error_code, error_message, response, duration_ms)
       VALUES ($1, (SELECT created_at FROM connector_deliveries WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)`, [
            delivery.id,
            delivery.attempts,
            input.status,
            input.httpStatus ?? null,
            input.errorCode ?? null,
            input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
            input.response ? JSON.stringify(input.response) : null,
            input.durationMs ?? null,
        ]);
    }
}
//# sourceMappingURL=delivery.repository.js.map