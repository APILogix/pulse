/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import {
  ConnectorConflictError,
  ConnectorNotFoundError,
  type ConnectorConfigRow,
  type ConnectorStatus,
  type ConnectorType,
  type DeliveryRow,
  type DeliveryStatus,
  type FailureCategory,
  type HealthCheckRow,
  type HealthState,
  type ListConnectorsQuery,
  type NotificationSeverity,
} from '../types.js';

export interface InsertDeliveryInput {
  organizationId: string;
  connectorId: string;
  routeId: string | null;
  notificationType: string;
  severity: NotificationSeverity;
  payload: Record<string, unknown>;
  maxAttempts: number;
  correlationId: string;
  parentDeliveryId: string | null;
  status: DeliveryStatus;
}

export class DeliveryRepository {
  private readonly db = pool;

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Connector CRUD ─────────────────────────────────────────────────────
  // ── Health / failure bookkeeping ───────────────────────────────────────
  // ── Deliveries ─────────────────────────────────────────────────────────
  async insertDelivery(input: InsertDeliveryInput): Promise<DeliveryRow> {
    const payloadJson = JSON.stringify(input.payload);
    const r = await this.db.query<DeliveryRow>(
      `INSERT INTO connector_deliveries
         (organization_id, connector_id, route_id, notification_type, severity,
          payload, payload_size_bytes, status, max_attempts, correlation_id, parent_delivery_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.organizationId, input.connectorId, input.routeId, input.notificationType,
        input.severity, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
        input.status, input.maxAttempts, input.correlationId, input.parentDeliveryId,
      ],
    );
    return r.rows[0]!;
  }

  async insertDeliveryIdempotent(input: InsertDeliveryInput): Promise<{ row: DeliveryRow, existed: boolean }> {
    return this.withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [input.connectorId, input.correlationId]);

      const existing = await client.query<DeliveryRow>(
        `SELECT * FROM connector_deliveries
         WHERE connector_id = $1 AND correlation_id = $2
           AND created_at > now() - interval '24 hours'
         LIMIT 1`,
        [input.connectorId, input.correlationId]
      );
      if (existing.rows.length > 0) {
        return { row: existing.rows[0]!, existed: true };
      }

      const payloadJson = JSON.stringify(input.payload);
      const r = await client.query<DeliveryRow>(
        `INSERT INTO connector_deliveries
           (organization_id, connector_id, route_id, notification_type, severity,
            payload, payload_size_bytes, status, max_attempts, correlation_id, parent_delivery_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          input.organizationId, input.connectorId, input.routeId, input.notificationType,
          input.severity, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
          input.status, input.maxAttempts, input.correlationId, input.parentDeliveryId,
        ],
      );
      return { row: r.rows[0]!, existed: false };
    });
  }

  async markDeliverySent(
    id: string,
    update: {
      externalMessageId: string | null;
      responseStatusCode: number | null;
      responseBody: string | null;
      latencyMs: number;
    },
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      const updated = await client.query<DeliveryRow>(
        `UPDATE connector_deliveries
         SET status='sent', attempts=attempts+1, sent_at=NOW(), updated_at=NOW(),
             external_message_id=$2, response_status_code=$3, response_body=$4::text,
             provider_response=$4::jsonb, http_status=$3, duration_ms=$5, delivery_latency_ms=$5
         WHERE id=$1
         RETURNING *`,
        [
          id,
          update.externalMessageId,
          update.responseStatusCode,
          update.responseBody ? JSON.stringify({ body: update.responseBody }) : null,
          update.latencyMs,
        ],
      );
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

  async markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string): Promise<void> {
    await this.withTransaction(async (client) => {
      const updated = await client.query<DeliveryRow>(
        `UPDATE connector_deliveries
         SET status='retrying', attempts=attempts+1, retry_count=retry_count+1,
             next_retry_at=$2, error_message=$3, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, nextRetryAt, errorMessage.slice(0, 2000)],
      );
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

  async markDeliveryFailed(
    id: string,
    errorMessage: string,
    errorDetails: Record<string, unknown> | null,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      const updated = await client.query<DeliveryRow>(
        `UPDATE connector_deliveries
         SET status='failed', attempts=attempts+1, failed_at=NOW(), updated_at=NOW(),
             error_message=$2, error_details=$3
         WHERE id=$1
         RETURNING *`,
        [id, errorMessage.slice(0, 2000), errorDetails ? JSON.stringify(errorDetails) : null],
      );
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
  async claimRetryableDeliveries(limit: number): Promise<DeliveryRow[]> {
    return this.withTransaction(async (client) => {
      await client.query(
        `UPDATE connector_deliveries
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
         )`
      );

      const r = await client.query<DeliveryRow>(
        `SELECT * FROM connector_deliveries
         WHERE status='retrying' AND next_retry_at <= NOW()
         ORDER BY next_retry_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return r.rows;
    });
  }

  async listDeliveries(
    organizationId: string,
    filters: { connectorId?: string; status?: DeliveryStatus; limit: number; offset: number },
  ): Promise<{ data: DeliveryRow[]; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [organizationId];
    if (filters.connectorId) { params.push(filters.connectorId); conditions.push(`connector_id=$${params.length}`); }
    if (filters.status) { params.push(filters.status); conditions.push(`status=$${params.length}`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM connector_deliveries WHERE ${where}`,
      params,
    );
    params.push(filters.limit, filters.offset);
    const r = await this.db.query<DeliveryRow>(
      `SELECT * FROM connector_deliveries WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getDelivery(organizationId: string, id: string): Promise<DeliveryRow | null> {
    const r = await this.db.query<DeliveryRow>(
      `SELECT * FROM connector_deliveries
       WHERE id=$1 AND organization_id=$2`,
      [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async findDeliveryByDedupKey(connectorId: string, dedupKey: string, windowMinutes: number): Promise<DeliveryRow | null> {
    const r = await this.db.query<DeliveryRow>(
      `SELECT * FROM connector_deliveries
       WHERE connector_id = $1
         AND payload->>'dedupKey' = $2
         AND status = 'sent'
         AND created_at > now() - ($3 || ' minutes')::interval
       LIMIT 1`,
      [connectorId, dedupKey, windowMinutes]
    );
    return r.rows[0] ?? null;
  }

  async listAttempts(
    organizationId: string,
    connectorId: string,
    deliveryId: string,
    filters: { limit: number; offset: number },
  ): Promise<{ data: import('../types.js').DeliveryAttemptRow[]; total: number }> {
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM connector_delivery_attempts a
       JOIN connector_deliveries d ON d.id=a.delivery_id AND d.created_at=a.delivery_created_at
       WHERE a.delivery_id=$1 AND d.organization_id=$2 AND d.connector_id=$3`,
      [deliveryId, organizationId, connectorId],
    );
    const rows = await this.db.query<import('../types.js').DeliveryAttemptRow>(
      `SELECT a.id, a.delivery_id, a.delivery_created_at, a.attempt_number, a.status,
              a.http_status, a.error_code, a.error_message, a.response, a.duration_ms, a.attempted_at
       FROM connector_delivery_attempts a
       JOIN connector_deliveries d ON d.id=a.delivery_id AND d.created_at=a.delivery_created_at
       WHERE a.delivery_id=$1 AND d.organization_id=$2 AND d.connector_id=$3
       ORDER BY a.attempted_at DESC
       LIMIT $4 OFFSET $5`,
      [deliveryId, organizationId, connectorId, filters.limit, filters.offset],
    );
    return { data: rows.rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async retryDelivery(organizationId: string, id: string): Promise<DeliveryRow | null> {
    const r = await this.db.query<DeliveryRow>(
      `UPDATE connector_deliveries
       SET status='retrying',
           attempts=0,
           retry_count=0,
           next_retry_at=NOW(),
           failed_at=NULL,
           error_message=NULL,
           error_details=NULL,
           updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND status IN ('failed','retrying')
       RETURNING *`,
      [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  // ── Dead letter ────────────────────────────────────────────────────────
  async insertDeadLetter(input: {
    originalDeliveryId: string;
    organizationId: string;
    connectorId: string;
    failureReason: string;
    failureCategory: FailureCategory;
    errorStack: string | null;
    originalPayload: Record<string, unknown>;
    retryAttempts: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO connector_audit_logs
         (organization_id, connector_id, action, actor_type, changes_summary, new_state)
       VALUES ($1,$2,'delivery.dead_lettered','system',$3,$4)`,
      [
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
      ],
    );
  }

  async getDlqGrowth(windowMinutes: number): Promise<number> {
    const r = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM connector_audit_logs
       WHERE action = 'delivery.dead_lettered'
         AND created_at > NOW() - ($1 || ' minutes')::interval`,
      [windowMinutes]
    );
    return Number(r.rows[0]?.count ?? 0);
  }

  private async insertAttempt(
    client: PoolClient,
    delivery: DeliveryRow,
    input: {
      status: DeliveryStatus;
      httpStatus?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      response?: Record<string, unknown> | null;
      durationMs?: number | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO connector_delivery_attempts
         (delivery_id, delivery_created_at, attempt_number, status, http_status,
          error_code, error_message, response, duration_ms)
       VALUES ($1, (SELECT created_at FROM connector_deliveries WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)`,
      [
        delivery.id,
        delivery.attempts,
        input.status,
        input.httpStatus ?? null,
        input.errorCode ?? null,
        input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
        input.response ? JSON.stringify(input.response) : null,
        input.durationMs ?? null,
      ],
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────────
}
