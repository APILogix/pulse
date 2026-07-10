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

const RULE_COLS = `
  id, organization_id, name, description, severity, enabled,
  evaluation_interval_seconds, cooldown_seconds, auto_resolve_after_minutes,
  deduplication_window_seconds, deduplication_key_template,
  grouping_enabled, grouping_key_template, grouping_wait_seconds,
  labels, annotations, metadata, created_by, updated_by,
  enabled_at, disabled_at, created_at, updated_at, deleted_at
`;

export interface RuleConditionInsert {
  conditionType: string;
  conditionGroupId: string | null;
  fieldPath: string;
  operator: string;
  thresholdValue: unknown;
  lookbackMinutes: number | null;
  aggregateFunction: string | null;
  isRequired: boolean;
  orderIndex: number;
}

export interface RuleActionInsert {
  actionType: string;
  priority: number;
  orderIndex: number;
  connectorId: string | null;
  routeId: string | null;
  templateId: string | null;
  escalationPolicyId: string | null;
  throttleDurationSeconds: number;
  maxNotificationsPerHour: number | null;
  actionConditions: Record<string, unknown>;
  isActive: boolean;
}

export interface CreateRuleInput {
  organizationId: string;
  name: string;
  description: string | null;
  severity: string;
  enabled: boolean;
  evaluationIntervalSeconds: number;
  cooldownSeconds: number;
  autoResolveAfterMinutes: number | null;
  deduplicationWindowSeconds: number;
  deduplicationKeyTemplate: string | null;
  groupingEnabled: boolean;
  groupingKeyTemplate: string | null;
  groupingWaitSeconds: number;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdBy: string;
  conditions: RuleConditionInsert[];
  actions: RuleActionInsert[];
}

export class RulesRepository {
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
  async createRule(input: CreateRuleInput): Promise<AlertRuleRow> {
    return this.withTransaction(async (client) => {
      let rule: AlertRuleRow;
      try {
        const r = await client.query<AlertRuleRow>(
          `INSERT INTO alert_rules
             (organization_id, name, description, severity, enabled,
              evaluation_interval_seconds, cooldown_seconds, auto_resolve_after_minutes,
              deduplication_window_seconds, deduplication_key_template,
              grouping_enabled, grouping_key_template, grouping_wait_seconds,
              labels, annotations, metadata, created_by, enabled_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                   CASE WHEN $5 THEN NOW() ELSE NULL END)
           RETURNING ${RULE_COLS}`,
          [
            input.organizationId, input.name, input.description, input.severity, input.enabled,
            input.evaluationIntervalSeconds, input.cooldownSeconds, input.autoResolveAfterMinutes,
            input.deduplicationWindowSeconds, input.deduplicationKeyTemplate,
            input.groupingEnabled, input.groupingKeyTemplate, input.groupingWaitSeconds,
            JSON.stringify(input.labels), JSON.stringify(input.annotations), JSON.stringify(input.metadata),
            input.createdBy,
          ],
        );
        rule = r.rows[0]!;
      } catch (e) {
        if (pgCode(e) === '23505') throw new AlertConflictError('An alert rule with this name already exists');
        throw e;
      }

      await this.insertConditions(client, rule.id, input.conditions);
      await this.insertActions(client, rule.id, input.actions);
      return rule;
    });
  }

  private async insertConditions(client: PoolClient, ruleId: string, conditions: RuleConditionInsert[]): Promise<void> {
    if (conditions.length === 0) return;
    await client.query(
      `INSERT INTO alert_rule_conditions
         (rule_id, condition_type, condition_group_id, field_path, operator,
          threshold_value, lookback_minutes, aggregate_function, is_required, order_index)
       SELECT $1, t.condition_type::alert_condition_type, t.condition_group_id, t.field_path,
              t.operator::alert_condition_operator, t.threshold_value, t.lookback_minutes,
              t.aggregate_function, t.is_required, t.order_index
       FROM UNNEST(
         $2::text[], $3::uuid[], $4::text[], $5::text[], $6::jsonb[],
         $7::int[], $8::text[], $9::boolean[], $10::int[]
       ) AS t(condition_type, condition_group_id, field_path, operator, threshold_value,
              lookback_minutes, aggregate_function, is_required, order_index)`,
      [
        ruleId,
        conditions.map((c) => c.conditionType),
        conditions.map((c) => c.conditionGroupId),
        conditions.map((c) => c.fieldPath),
        conditions.map((c) => c.operator),
        conditions.map((c) => JSON.stringify(c.thresholdValue ?? null)),
        conditions.map((c) => c.lookbackMinutes),
        conditions.map((c) => c.aggregateFunction),
        conditions.map((c) => c.isRequired),
        conditions.map((c) => c.orderIndex),
      ],
    );
  }

  private async insertActions(client: PoolClient, ruleId: string, actions: RuleActionInsert[]): Promise<void> {
    if (actions.length === 0) return;
    await client.query(
      `INSERT INTO alert_rule_actions
         (rule_id, action_type, priority, order_index, connector_id, route_id,
          template_id, escalation_policy_id, throttle_duration_seconds,
          max_notifications_per_hour, action_conditions, is_active)
       SELECT $1, t.action_type::alert_action_type, t.priority, t.order_index, t.connector_id,
              t.route_id, t.template_id, t.escalation_policy_id, t.throttle_duration_seconds,
              t.max_notifications_per_hour, t.action_conditions, t.is_active
       FROM UNNEST(
         $2::text[], $3::int[], $4::int[], $5::uuid[], $6::uuid[], $7::uuid[], $8::uuid[],
         $9::int[], $10::int[], $11::jsonb[], $12::boolean[]
       ) AS t(action_type, priority, order_index, connector_id, route_id, template_id,
              escalation_policy_id, throttle_duration_seconds, max_notifications_per_hour,
              action_conditions, is_active)`,
      [
        ruleId,
        actions.map((a) => a.actionType),
        actions.map((a) => a.priority),
        actions.map((a) => a.orderIndex),
        actions.map((a) => a.connectorId),
        actions.map((a) => a.routeId),
        actions.map((a) => a.templateId),
        actions.map((a) => a.escalationPolicyId),
        actions.map((a) => a.throttleDurationSeconds),
        actions.map((a) => a.maxNotificationsPerHour),
        actions.map((a) => JSON.stringify(a.actionConditions)),
        actions.map((a) => a.isActive),
      ],
    );
  }

  async findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null> {
    const r = await this.db.query<AlertRuleRow>(
      `SELECT ${RULE_COLS} FROM alert_rules WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]> {
    const r = await this.db.query<AlertRuleConditionRow>(
      `SELECT * FROM alert_rule_conditions WHERE rule_id=$1 ORDER BY order_index ASC`,
      [ruleId],
    );
    return r.rows;
  }

  async getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]> {
    const r = await this.db.query<AlertRuleActionRow>(
      `SELECT * FROM alert_rule_actions WHERE rule_id=$1 ORDER BY order_index ASC, priority DESC`,
      [ruleId],
    );
    return r.rows;
  }

  async listRules(organizationId: string, query: ListRulesQuery): Promise<{ data: AlertRuleRow[]; total: number }> {
    const conditions = ['organization_id=$1', 'deleted_at IS NULL'];
    const params: unknown[] = [organizationId];
    if (query.enabled !== undefined) { params.push(query.enabled); conditions.push(`enabled=$${params.length}`); }
    if (query.severity) { params.push(query.severity); conditions.push(`severity=$${params.length}`); }
    if (query.search) { params.push(`%${query.search}%`); conditions.push(`name ILIKE $${params.length}`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_rules WHERE ${where}`, params,
    );
    params.push(query.limit, query.offset);
    const r = await this.db.query<AlertRuleRow>(
      `SELECT ${RULE_COLS} FROM alert_rules WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  /** Replace a rule's scalar fields and (optionally) its conditions/actions. */
  async updateRule(
    organizationId: string,
    id: string,
    fields: Record<string, unknown>,
    conditions: RuleConditionInsert[] | null,
    actions: RuleActionInsert[] | null,
    updatedBy: string,
  ): Promise<AlertRuleRow> {
    return this.withTransaction(async (client) => {
      const map: Record<string, string> = {
        name: 'name', description: 'description', severity: 'severity', enabled: 'enabled',
        evaluationIntervalSeconds: 'evaluation_interval_seconds', cooldownSeconds: 'cooldown_seconds',
        autoResolveAfterMinutes: 'auto_resolve_after_minutes',
        deduplicationWindowSeconds: 'deduplication_window_seconds',
        deduplicationKeyTemplate: 'deduplication_key_template',
        groupingEnabled: 'grouping_enabled', groupingKeyTemplate: 'grouping_key_template',
        groupingWaitSeconds: 'grouping_wait_seconds',
        labels: 'labels', annotations: 'annotations', metadata: 'metadata',
      };
      const setParts: string[] = [`updated_by=$1`];
      const vals: unknown[] = [updatedBy];
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || !map[k]) continue;
        vals.push(['labels', 'annotations', 'metadata'].includes(k) ? JSON.stringify(v) : v);
        setParts.push(`${map[k]}=$${vals.length}`);
      }
      if (fields.enabled === true) setParts.push('enabled_at=NOW()');
      if (fields.enabled === false) setParts.push('disabled_at=NOW()');

      vals.push(id, organizationId);
      let rule: AlertRuleRow;
      try {
        const r = await client.query<AlertRuleRow>(
          `UPDATE alert_rules SET ${setParts.join(',')}
           WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL
           RETURNING ${RULE_COLS}`,
          vals,
        );
        if (!r.rows[0]) throw new AlertNotFoundError('Alert rule');
        rule = r.rows[0];
      } catch (e) {
        if (pgCode(e) === '23505') throw new AlertConflictError('An alert rule with this name already exists');
        throw e;
      }

      if (conditions) {
        await client.query(`DELETE FROM alert_rule_conditions WHERE rule_id=$1`, [id]);
        await this.insertConditions(client, id, conditions);
      }
      if (actions) {
        await client.query(`DELETE FROM alert_rule_actions WHERE rule_id=$1`, [id]);
        await this.insertActions(client, id, actions);
      }
      return rule;
    });
  }

  async softDeleteRule(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE alert_rules SET deleted_at=NOW(), enabled=false, disabled_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new AlertNotFoundError('Alert rule');
  }

  async setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow> {
    const r = await this.db.query<AlertRuleRow>(
      `UPDATE alert_rules
       SET enabled=$3,
           enabled_at = CASE WHEN $3 THEN NOW() ELSE enabled_at END,
           disabled_at = CASE WHEN $3 THEN disabled_at ELSE NOW() END
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
       RETURNING ${RULE_COLS}`,
      [id, organizationId, enabled],
    );
    if (!r.rows[0]) throw new AlertNotFoundError('Alert rule');
    return r.rows[0];
  }

  // ── Events: ingestion + deduplication ────────────────────────────────────
  // ── Batch lifecycle ──────────────────────────────────────────────────────
  // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
  // ── Silences ─────────────────────────────────────────────────────────────
  // ── Escalation policies + steps ──────────────────────────────────────────
  // ── Templates ────────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
}
