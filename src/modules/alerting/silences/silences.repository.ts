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

export class SilencesRepository {
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
  async createSilence(input: {
    organizationId: string; ruleId: string | null; createdBy: string; comment: string | null;
    startsAt: Date; endsAt: Date; matchers: Record<string, unknown>;
  }): Promise<AlertSilenceRow> {
    const r = await this.db.query<AlertSilenceRow>(
      `INSERT INTO alert_silences (organization_id, rule_id, created_by, comment, starts_at, ends_at, matchers)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.organizationId, input.ruleId, input.createdBy, input.comment, input.startsAt, input.endsAt, JSON.stringify(input.matchers)],
    );
    return r.rows[0]!;
  }

  async listSilences(organizationId: string, active: boolean | undefined, limit: number, offset: number): Promise<{ data: AlertSilenceRow[]; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [organizationId];
    if (active === true) conditions.push(`is_active=true AND ends_at > NOW()`);
    if (active === false) conditions.push(`(is_active=false OR ends_at <= NOW())`);
    const where = conditions.join(' AND ');
    const countRes = await this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM alert_silences WHERE ${where}`, params);
    params.push(limit, offset);
    const r = await this.db.query<AlertSilenceRow>(
      `SELECT * FROM alert_silences WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async expireSilence(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_silences SET is_active=false, expired_at=NOW(), ends_at=LEAST(ends_at, NOW())
       WHERE id=$1 AND organization_id=$2 AND is_active=true`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Active silence');
  }

  /** Active silences applicable to a rule (rule-specific or global) right now. */
  async findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]> {
    const r = await this.db.query<AlertSilenceRow>(
      `SELECT * FROM alert_silences
       WHERE organization_id=$1 AND is_active=true
         AND starts_at <= NOW() AND ends_at > NOW()
         AND (rule_id IS NULL OR rule_id=$2)`,
      [organizationId, ruleId],
    );
    return r.rows;
  }

  // ── Escalation policies + steps ──────────────────────────────────────────
  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
