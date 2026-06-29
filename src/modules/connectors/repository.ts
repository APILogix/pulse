/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { pool } from '../../config/database.js';
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
} from './types.js';

const CONNECTOR_COLUMNS = `
  id, organization_id, name, type, status, description,
  encrypted_config, config_schema_version, display_config,
  supports_rich_formatting, supports_threading, supports_attachments,
  rate_limit_requests, rate_limit_window_seconds,
  max_retries, retry_backoff_base_ms, retry_backoff_multiplier,
  last_health_check_at, last_successful_delivery_at,
  consecutive_failures, failure_threshold,
  metadata, created_by, created_at, updated_at, deleted_at
`;

export interface CreateConnectorInput {
  organizationId: string;
  name: string;
  type: ConnectorType;
  description: string | null;
  encryptedConfig: Buffer;
  displayConfig: Record<string, unknown>;
  capabilities: { richFormatting: boolean; threading: boolean; attachments: boolean };
  rateLimitRequests: number;
  rateLimitWindowSeconds: number;
  maxRetries: number;
  failureThreshold: number;
  metadata: Record<string, unknown>;
  createdBy: string | null;
}

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

export class ConnectorRepository {
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
  async create(input: CreateConnectorInput): Promise<ConnectorConfigRow> {
    try {
      const r = await this.db.query<ConnectorConfigRow>(
        `INSERT INTO connector_configs
           (organization_id, name, type, status, description, encrypted_config,
            display_config, supports_rich_formatting, supports_threading, supports_attachments,
            rate_limit_requests, rate_limit_window_seconds, max_retries, failure_threshold,
            metadata, created_by)
         VALUES ($1,$2,$3,'pending_setup',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${CONNECTOR_COLUMNS}`,
        [
          input.organizationId, input.name, input.type, input.description,
          input.encryptedConfig, JSON.stringify(input.displayConfig),
          input.capabilities.richFormatting, input.capabilities.threading, input.capabilities.attachments,
          input.rateLimitRequests, input.rateLimitWindowSeconds, input.maxRetries, input.failureThreshold,
          JSON.stringify(input.metadata), input.createdBy,
        ],
      );
      return r.rows[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConnectorConflictError('A connector with this name already exists');
      }
      throw e;
    }
  }

  async findById(organizationId: string, id: string): Promise<ConnectorConfigRow | null> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  /** Fetch without org scoping — only for trusted internal paths (workers). */
  async findByIdInternal(id: string): Promise<ConnectorConfigRow | null> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /**
   * Bulk-fetch connectors by id (single query — no N+1). Used by the alerting
   * batch worker to resolve every connector referenced by a batch of events.
   * Not org-scoped: callers must already have validated tenant ownership of
   * the events that reference these connector ids.
   */
  async getByIds(ids: string[]): Promise<ConnectorConfigRow[]> {
    if (ids.length === 0) return [];
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    return r.rows;
  }

  async list(
    organizationId: string,
    query: ListConnectorsQuery,
  ): Promise<{ data: ConnectorConfigRow[]; total: number }> {
    const conditions: string[] = ['organization_id=$1', 'deleted_at IS NULL'];
    const params: unknown[] = [organizationId];

    if (query.type) { params.push(query.type); conditions.push(`type=$${params.length}`); }
    if (query.status) { params.push(query.status); conditions.push(`status=$${params.length}`); }
    if (query.search) { params.push(`%${query.search}%`); conditions.push(`name ILIKE $${params.length}`); }

    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM connector_configs WHERE ${where}`,
      params,
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    params.push(query.limit, query.offset);
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total };
  }

  /** All non-deleted connectors in an active/error state (for health sweeps). */
  async listMonitorable(): Promise<ConnectorConfigRow[]> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE deleted_at IS NULL AND status IN ('active','error')`,
    );
    return r.rows;
  }

  async update(
    organizationId: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<ConnectorConfigRow> {
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      status: 'status',
      encryptedConfig: 'encrypted_config',
      displayConfig: 'display_config',
      richFormatting: 'supports_rich_formatting',
      threading: 'supports_threading',
      attachments: 'supports_attachments',
      rateLimitRequests: 'rate_limit_requests',
      rateLimitWindowSeconds: 'rate_limit_window_seconds',
      maxRetries: 'max_retries',
      failureThreshold: 'failure_threshold',
      metadata: 'metadata',
    };
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || !map[k]) continue;
      cols.push(`${map[k]}=$${cols.length + 1}`);
      vals.push(k === 'displayConfig' || k === 'metadata' ? JSON.stringify(v) : v);
    }
    if (cols.length === 0) {
      const existing = await this.findById(organizationId, id);
      if (!existing) throw new ConnectorNotFoundError(id);
      return existing;
    }
    vals.push(id, organizationId);
    try {
      const r = await this.db.query<ConnectorConfigRow>(
        `UPDATE connector_configs SET ${cols.join(',')}
         WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL
         RETURNING ${CONNECTOR_COLUMNS}`,
        vals,
      );
      if (!r.rows[0]) throw new ConnectorNotFoundError(id);
      return r.rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConnectorConflictError('A connector with this name already exists');
      }
      throw e;
    }
  }

  async softDelete(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE connector_configs SET deleted_at=NOW(), status='inactive'
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new ConnectorNotFoundError(id);
  }

  // ── Health / failure bookkeeping ───────────────────────────────────────
  async recordSuccess(connectorId: string): Promise<void> {
    await this.db.query(
      `UPDATE connector_configs
       SET consecutive_failures=0, last_successful_delivery_at=NOW(),
           status = CASE WHEN status='error' THEN 'active' ELSE status END
       WHERE id=$1`,
      [connectorId],
    );
  }

  /** Increment failures; flip to 'error' once the threshold is crossed. */
  async recordFailure(connectorId: string): Promise<{ consecutiveFailures: number; tripped: boolean }> {
    const r = await this.db.query<{ consecutive_failures: number; failure_threshold: number; status: ConnectorStatus }>(
      `UPDATE connector_configs
       SET consecutive_failures = consecutive_failures + 1,
           status = CASE
             WHEN consecutive_failures + 1 >= failure_threshold THEN 'error'::connector_status
             ELSE status
           END
       WHERE id=$1
       RETURNING consecutive_failures, failure_threshold, status`,
      [connectorId],
    );
    const row = r.rows[0];
    return {
      consecutiveFailures: row?.consecutive_failures ?? 0,
      tripped: row?.status === 'error',
    };
  }

  async insertHealthCheck(
    connectorId: string,
    state: HealthState,
    responseTimeMs: number | null,
    errorMessage: string | null,
    details: Record<string, unknown>,
  ): Promise<HealthCheckRow> {
    const r = await this.db.query<HealthCheckRow>(
      `INSERT INTO connector_health_checks (connector_id, status, response_time_ms, error_message, details)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, connector_id, status, response_time_ms, error_message, details, checked_at`,
      [connectorId, state, responseTimeMs, errorMessage, JSON.stringify(details)],
    );
    await this.db.query(
      `UPDATE connector_configs SET last_health_check_at=NOW() WHERE id=$1`,
      [connectorId],
    );
    return r.rows[0]!;
  }

  async setStatus(organizationId: string, id: string, status: ConnectorStatus): Promise<void> {
    const r = await this.db.query(
      `UPDATE connector_configs SET status=$1
       WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL`,
      [status, id, organizationId],
    );
    if (r.rowCount === 0) throw new ConnectorNotFoundError(id);
  }

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
  async insertAuditLog(input: {
    organizationId: string;
    connectorId: string | null;
    action: string;
    actorId: string | null;
    actorType?: string;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    changesSummary?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO connector_audit_logs
         (organization_id, connector_id, action, actor_id, actor_type,
          previous_state, new_state, changes_summary, ip_address, user_agent, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.organizationId, input.connectorId, input.action, input.actorId,
        input.actorType ?? 'user',
        input.previousState ? JSON.stringify(input.previousState) : null,
        input.newState ? JSON.stringify(input.newState) : null,
        input.changesSummary ? JSON.stringify(input.changesSummary) : null,
        input.ipAddress ?? null, input.userAgent ?? null, input.requestId ?? null,
      ],
    );
  }
}
