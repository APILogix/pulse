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

export class ConnectorAuditRepository {
  private readonly db = pool;
  // ── Connector CRUD ─────────────────────────────────────────────────────
  // ── Health / failure bookkeeping ───────────────────────────────────────
  // ── Deliveries ─────────────────────────────────────────────────────────
  // ── Dead letter ────────────────────────────────────────────────────────
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
