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

  // ── Deliveries ─────────────────────────────────────────────────────────
  // ── Dead letter ────────────────────────────────────────────────────────
  // ── Audit ──────────────────────────────────────────────────────────────
}
