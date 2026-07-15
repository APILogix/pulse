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

export class ConnectorMetricsRepository {
  private readonly db = pool;
  // ── Connector CRUD ─────────────────────────────────────────────────────
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
             WHEN consecutive_failures + 1 >= failure_threshold THEN 'error'
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
      `UPDATE connector_configs
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
       WHERE id=$1`,
      [connectorId, state],
    );
    return r.rows[0]!;
  }

  async listHealthChecks(
    organizationId: string,
    connectorId: string,
    filters: { limit: number; offset: number },
  ): Promise<{ data: HealthCheckRow[]; total: number }> {
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM connector_health_checks h
       JOIN connector_configs c ON c.id=h.connector_id
       WHERE h.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL`,
      [connectorId, organizationId],
    );
    const data = await this.db.query<HealthCheckRow>(
      `SELECT h.id, h.connector_id, h.status, h.response_time_ms, h.error_message, h.details, h.checked_at
       FROM connector_health_checks h
       JOIN connector_configs c ON c.id=h.connector_id
       WHERE h.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL
       ORDER BY h.checked_at DESC
       LIMIT $3 OFFSET $4`,
      [connectorId, organizationId, filters.limit, filters.offset],
    );
    return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async insertTestRun(input: {
    connectorId: string;
    triggeredBy: string | null;
    status: string;
    response: Record<string, unknown> | null;
    durationMs: number | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO connector_test_runs
         (connector_id, triggered_by, status, response, duration_ms)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.connectorId,
        input.triggeredBy,
        input.status,
        input.response ? JSON.stringify(input.response) : null,
        input.durationMs,
      ],
    );
  }

  async listTestRuns(
    organizationId: string,
    connectorId: string,
    filters: { limit: number; offset: number },
  ): Promise<{ data: import('../types.js').ConnectorTestRunRow[]; total: number }> {
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM connector_test_runs t
       JOIN connector_configs c ON c.id=t.connector_id
       WHERE t.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL`,
      [connectorId, organizationId],
    );
    const data = await this.db.query<import('../types.js').ConnectorTestRunRow>(
      `SELECT t.id, t.connector_id, t.triggered_by, t.status, t.response, t.duration_ms, t.created_at
       FROM connector_test_runs t
       JOIN connector_configs c ON c.id=t.connector_id
       WHERE t.connector_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL
       ORDER BY t.created_at DESC
       LIMIT $3 OFFSET $4`,
      [connectorId, organizationId, filters.limit, filters.offset],
    );
    return { data: data.rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  // ── Deliveries ─────────────────────────────────────────────────────────
  // ── Dead letter ────────────────────────────────────────────────────────
  // ── Audit ──────────────────────────────────────────────────────────────
}
