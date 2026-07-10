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
      `INSERT INTO notification_deliveries
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

  async markDeliverySent(
    id: string,
    update: {
      externalMessageId: string | null;
      responseStatusCode: number | null;
      responseBody: string | null;
      latencyMs: number;
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE notification_deliveries
       SET status='sent', attempts=attempts+1, sent_at=NOW(),
           external_message_id=$2, response_status_code=$3, response_body=$4, delivery_latency_ms=$5
       WHERE id=$1`,
      [id, update.externalMessageId, update.responseStatusCode, update.responseBody, update.latencyMs],
    );
  }

  async markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE notification_deliveries
       SET status='retrying', attempts=attempts+1, retry_count=retry_count+1,
           next_retry_at=$2, error_message=$3
       WHERE id=$1`,
      [id, nextRetryAt, errorMessage.slice(0, 2000)],
    );
  }

  async markDeliveryFailed(
    id: string,
    errorMessage: string,
    errorDetails: Record<string, unknown> | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE notification_deliveries
       SET status='failed', attempts=attempts+1, failed_at=NOW(),
           error_message=$2, error_details=$3
       WHERE id=$1`,
      [id, errorMessage.slice(0, 2000), errorDetails ? JSON.stringify(errorDetails) : null],
    );
  }

  /** Claim due retry rows for processing (SKIP LOCKED for safe concurrency). */
  async claimRetryableDeliveries(limit: number): Promise<DeliveryRow[]> {
    return this.withTransaction(async (client) => {
      const r = await client.query<DeliveryRow>(
        `SELECT * FROM notification_deliveries
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
      `SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE ${where}`,
      params,
    );
    params.push(filters.limit, filters.offset);
    const r = await this.db.query<DeliveryRow>(
      `SELECT * FROM notification_deliveries WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
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
      `INSERT INTO notification_dead_letter
         (original_delivery_id, organization_id, connector_id, failure_reason,
          failure_category, error_stack, original_payload, retry_attempts, last_retry_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        input.originalDeliveryId, input.organizationId, input.connectorId,
        input.failureReason.slice(0, 4000), input.failureCategory, input.errorStack,
        JSON.stringify(input.originalPayload), input.retryAttempts,
      ],
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────────
}
