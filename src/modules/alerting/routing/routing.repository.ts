/**
 * Alerting persistence layer.
 *
 * Owns all SQL for the alerting module. Tenant isolation is enforced in the
 * service layer by always passing `organization_id` into queries (this
 * codebase isolates tenants in the application layer — see migration 003).
 *
 * Performance contract for the batch worker:
 *   - `getBatchWithEvents` fetches a batch + its events in ONE query.
 *   - `bulkUpdateEventStatus` / `bulkInsertDeliveryAttempts` use UNNEST-based
 *     set operations — NO per-row (N+1) writes.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import {
  AlertConflictError,
  AlertNotFoundError,
  type AlertBatchRow,
  type AlertDeliveryAttemptRow,
  type AlertEscalationPolicyRow,
  type AlertEscalationStepRow,
  type AlertEventRow,
  type AlertEventStatus,
  type AlertMetricRow,
  type AlertRoutingRuleRow,
  type AlertRuleActionRow,
  type AlertRuleConditionRow,
  type AlertRuleRow,
  type AlertSilenceRow,
  type AlertTemplateRow,
  type DeliveryAttemptStatus,
  type ListEventsQuery,
  type ListRulesQuery,
  type MetricGranularity,
} from '../types.js';

function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
}

export class RoutingRepository {
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

  // ── Rules ──────────────────────────────────────────────────────────────
  // ── Events: ingestion + deduplication ────────────────────────────────────
  // ── Batch lifecycle ──────────────────────────────────────────────────────
  // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
  // ── Silences ─────────────────────────────────────────────────────────────
  // ── Escalation policies + steps ──────────────────────────────────────────
  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  async createRoutingRule(input: {
    organizationId: string; name: string; description: string | null; priority: number;
    conditions: Record<string, unknown>; targetConnectorIds: string[]; targetRouteIds: string[];
    fallbackConnectorIds: string[]; templateId: string | null; isActive: boolean;
  }): Promise<AlertRoutingRuleRow> {
    try {
      const r = await this.db.query<AlertRoutingRuleRow>(
        `INSERT INTO alert_routing_rules
           (organization_id, name, description, priority, conditions, target_connector_ids,
            target_route_ids, fallback_connector_ids, template_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          input.organizationId, input.name, input.description, input.priority,
          JSON.stringify(input.conditions), input.targetConnectorIds, input.targetRouteIds,
          input.fallbackConnectorIds, input.templateId, input.isActive,
        ],
      );
      return r.rows[0]!;
    } catch (e) {
      if (pgCode(e) === '23505') throw new AlertConflictError('A routing rule with this name already exists');
      throw e;
    }
  }

  async listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]> {
    const r = await this.db.query<AlertRoutingRuleRow>(
      `SELECT * FROM alert_routing_rules WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY priority DESC, created_at DESC`,
      [organizationId],
    );
    return r.rows;
  }

  async findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null> {
    const r = await this.db.query<AlertRoutingRuleRow>(
      `SELECT * FROM alert_routing_rules WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async deleteRoutingRule(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_routing_rules SET deleted_at=NOW(), is_active=false WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Routing rule');
  }

  // ── Metrics + stats ──────────────────────────────────────────────────────
}
