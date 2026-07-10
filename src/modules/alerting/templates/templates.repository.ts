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

export class TemplatesRepository {
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
  async createTemplate(input: {
    organizationId: string; name: string; templateType: string; content: string;
    variablesSchema: unknown[]; defaultForSeverity: string | null; connectorType: string | null;
    isDefault: boolean; sampleData: Record<string, unknown>;
  }): Promise<AlertTemplateRow> {
    try {
      const r = await this.db.query<AlertTemplateRow>(
        `INSERT INTO alert_templates
           (organization_id, name, template_type, content, variables_schema, default_for_severity, connector_type, is_default, sample_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          input.organizationId, input.name, input.templateType, input.content,
          JSON.stringify(input.variablesSchema), input.defaultForSeverity, input.connectorType,
          input.isDefault, JSON.stringify(input.sampleData),
        ],
      );
      return r.rows[0]!;
    } catch (e) {
      if (pgCode(e) === '23505') throw new AlertConflictError('A template with this name already exists');
      throw e;
    }
  }

  async findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null> {
    const r = await this.db.query<AlertTemplateRow>(
      `SELECT * FROM alert_templates WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async listTemplates(organizationId: string, limit: number, offset: number): Promise<{ data: AlertTemplateRow[]; total: number }> {
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_templates WHERE organization_id=$1 AND deleted_at IS NULL`, [organizationId],
    );
    const r = await this.db.query<AlertTemplateRow>(
      `SELECT * FROM alert_templates WHERE organization_id=$1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [organizationId, limit, offset],
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async deleteTemplate(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_templates SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Template');
  }

  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
