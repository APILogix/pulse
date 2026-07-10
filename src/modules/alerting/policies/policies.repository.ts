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

export class PoliciesRepository {
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
  async createEscalationPolicy(input: {
    organizationId: string; name: string; description: string | null;
    repeatIntervalMinutes: number | null; maxRepeats: number; isActive: boolean;
  }): Promise<AlertEscalationPolicyRow> {
    try {
      const r = await this.db.query<AlertEscalationPolicyRow>(
        `INSERT INTO alert_escalation_policies (organization_id, name, description, repeat_interval_minutes, max_repeats, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.organizationId, input.name, input.description, input.repeatIntervalMinutes, input.maxRepeats, input.isActive],
      );
      return r.rows[0]!;
    } catch (e) {
      if (pgCode(e) === '23505') throw new AlertConflictError('An escalation policy with this name already exists');
      throw e;
    }
  }

  async listEscalationPolicies(organizationId: string, limit: number, offset: number): Promise<{ data: AlertEscalationPolicyRow[]; total: number }> {
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_escalation_policies WHERE organization_id=$1 AND deleted_at IS NULL`, [organizationId],
    );
    const r = await this.db.query<AlertEscalationPolicyRow>(
      `SELECT * FROM alert_escalation_policies WHERE organization_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [organizationId, limit, offset],
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async findEscalationPolicy(organizationId: string, id: string): Promise<AlertEscalationPolicyRow | null> {
    const r = await this.db.query<AlertEscalationPolicyRow>(
      `SELECT * FROM alert_escalation_policies WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async deleteEscalationPolicy(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_escalation_policies SET deleted_at=NOW(), is_active=false WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Escalation policy');
  }

  async upsertEscalationStep(policyId: string, input: {
    stepNumber: number; waitMinutes: number; connectorIds: string[]; routeIds: string[];
    notifyOnCall: boolean; customMessageTemplate: string | null; templateId: string | null; isActive: boolean;
  }): Promise<AlertEscalationStepRow> {
    const r = await this.db.query<AlertEscalationStepRow>(
      `INSERT INTO alert_escalation_steps
         (policy_id, step_number, wait_minutes, connector_ids, route_ids, notify_on_call, custom_message_template, template_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (policy_id, step_number) DO UPDATE SET
         wait_minutes=EXCLUDED.wait_minutes, connector_ids=EXCLUDED.connector_ids,
         route_ids=EXCLUDED.route_ids, notify_on_call=EXCLUDED.notify_on_call,
         custom_message_template=EXCLUDED.custom_message_template, template_id=EXCLUDED.template_id,
         is_active=EXCLUDED.is_active, updated_at=NOW()
       RETURNING *`,
      [policyId, input.stepNumber, input.waitMinutes, input.connectorIds, input.routeIds,
       input.notifyOnCall, input.customMessageTemplate, input.templateId, input.isActive],
    );
    return r.rows[0]!;
  }

  async listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]> {
    const r = await this.db.query<AlertEscalationStepRow>(
      `SELECT * FROM alert_escalation_steps WHERE policy_id=$1 ORDER BY step_number ASC`, [policyId],
    );
    return r.rows;
  }

  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
