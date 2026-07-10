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

export class MetricsRepository {
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
  // ── Metrics + stats ──────────────────────────────────────────────────────
  async queryMetrics(organizationId: string, filters: {
    metricType?: string; ruleId?: string; granularity: MetricGranularity; from?: Date; to?: Date; limit: number;
  }): Promise<AlertMetricRow[]> {
    const conditions = ['organization_id=$1', 'granularity=$2'];
    const params: unknown[] = [organizationId, filters.granularity];
    if (filters.metricType) { params.push(filters.metricType); conditions.push(`metric_type=$${params.length}`); }
    if (filters.ruleId) { params.push(filters.ruleId); conditions.push(`rule_id=$${params.length}`); }
    if (filters.from) { params.push(filters.from); conditions.push(`bucket_start >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); conditions.push(`bucket_start <= $${params.length}`); }
    params.push(filters.limit);
    const r = await this.db.query<AlertMetricRow>(
      `SELECT * FROM alert_metrics WHERE ${conditions.join(' AND ')}
       ORDER BY bucket_start DESC LIMIT $${params.length}`, params,
    );
    return r.rows;
  }

  /** Real-time dashboard stats computed directly from alert_events. */
  async getRealtimeStats(organizationId: string): Promise<{
    firing: number; acknowledged: number; resolvedLast24h: number; mttrSeconds: number | null; mttaSeconds: number | null;
  }> {
    const r = await this.db.query<{
      firing: string; acknowledged: string; resolved_24h: string; mttr: string | null; mtta: string | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status='firing')::text AS firing,
         COUNT(*) FILTER (WHERE status='acknowledged')::text AS acknowledged,
         COUNT(*) FILTER (WHERE status='resolved' AND resolved_at >= NOW() - INTERVAL '24 hours')::text AS resolved_24h,
         AVG(EXTRACT(EPOCH FROM (resolved_at - started_at))) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= NOW() - INTERVAL '24 hours')::text AS mttr,
         AVG(EXTRACT(EPOCH FROM (acknowledged_at - started_at))) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at >= NOW() - INTERVAL '24 hours')::text AS mtta
       FROM alert_events WHERE organization_id=$1`,
      [organizationId],
    );
    const row = r.rows[0]!;
    return {
      firing: Number(row.firing),
      acknowledged: Number(row.acknowledged),
      resolvedLast24h: Number(row.resolved_24h),
      mttrSeconds: row.mttr !== null ? Math.round(Number(row.mttr)) : null,
      mttaSeconds: row.mtta !== null ? Math.round(Number(row.mtta)) : null,
    };
  }
}
