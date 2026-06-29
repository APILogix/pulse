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
import { pool } from '../../config/database.js';
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
} from './types.js';

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

export interface InsertEventInput {
  organizationId: string;
  ruleId: string | null;
  status: AlertEventStatus;
  severity: string;
  fingerprint: string;
  source: string;
  sourceId: string | null;
  payload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown> | null;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  autoResolveAt: Date | null;
}

export interface DeliveryAttemptInsert {
  organizationId: string;
  eventId: string;
  connectorId: string | null;
  routeId: string | null;
  batchId: string | null;
  status: DeliveryAttemptStatus;
  responseStatusCode: number | null;
  errorMessage: string | null;
  errorCategory: string | null;
  latencyMs: number | null;
  externalMessageId: string | null;
}

export class AlertingRepository {
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
  /** Find an active (firing/acknowledged) event matching a fingerprint within the dedup window. */
  async findActiveEventByFingerprint(
    organizationId: string,
    fingerprint: string,
    windowSeconds: number,
  ): Promise<AlertEventRow | null> {
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events
       WHERE organization_id=$1 AND fingerprint=$2
         AND status IN ('firing','acknowledged','pending','processing')
         AND started_at >= NOW() - ($3 || ' seconds')::interval
       ORDER BY started_at DESC LIMIT 1`,
      [organizationId, fingerprint, String(windowSeconds)],
    );
    return r.rows[0] ?? null;
  }

  async incrementDuplicate(eventId: string): Promise<AlertEventRow> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events SET duplicate_count = duplicate_count + 1 WHERE id=$1 RETURNING *`,
      [eventId],
    );
    if (!r.rows[0]) throw new AlertNotFoundError('Alert event');
    return r.rows[0];
  }

  async insertEvent(input: InsertEventInput): Promise<AlertEventRow> {
    const payloadJson = JSON.stringify(input.payload);
    const r = await this.db.query<AlertEventRow>(
      `INSERT INTO alert_events
         (organization_id, rule_id, status, severity, fingerprint, source, source_id,
          payload, payload_size_bytes, normalized_payload, labels, annotations, auto_resolve_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        input.organizationId, input.ruleId, input.status, input.severity, input.fingerprint,
        input.source, input.sourceId, payloadJson, Buffer.byteLength(payloadJson, 'utf8'),
        input.normalizedPayload ? JSON.stringify(input.normalizedPayload) : null,
        JSON.stringify(input.labels), JSON.stringify(input.annotations), input.autoResolveAt,
      ],
    );
    return r.rows[0]!;
  }

  async findEventById(organizationId: string, id: string): Promise<AlertEventRow | null> {
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE id=$1 AND organization_id=$2`, [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  async listEvents(organizationId: string, query: ListEventsQuery): Promise<{ data: AlertEventRow[]; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [organizationId];
    if (query.status) { params.push(query.status); conditions.push(`status=$${params.length}`); }
    if (query.severity) { params.push(query.severity); conditions.push(`severity=$${params.length}`); }
    if (query.source) { params.push(query.source); conditions.push(`source=$${params.length}`); }
    if (query.ruleId) { params.push(query.ruleId); conditions.push(`rule_id=$${params.length}`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_events WHERE ${where}`, params,
    );
    params.push(query.limit, query.offset);
    const r = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async acknowledgeEvent(
    organizationId: string, eventId: string, userId: string, expiresAt: Date | null, comment: string | null,
  ): Promise<AlertEventRow> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertEventRow>(
        `UPDATE alert_events
         SET status='acknowledged', acknowledged_by=$3, acknowledged_at=NOW(),
             acknowledgment_expires_at=$4, next_escalation_at=NULL
         WHERE id=$1 AND organization_id=$2 AND status IN ('firing','pending','processing')
         RETURNING *`,
        [eventId, organizationId, userId, expiresAt],
      );
      if (!r.rows[0]) throw new AlertNotFoundError('Active alert event');
      // Deactivate any prior active ack, then insert the new one (partial unique idx).
      await client.query(
        `UPDATE alert_acknowledgments SET is_active=false WHERE event_id=$1 AND is_active=true`, [eventId],
      );
      await client.query(
        `INSERT INTO alert_acknowledgments (event_id, organization_id, acknowledged_by, expires_at, comment)
         VALUES ($1,$2,$3,$4,$5)`,
        [eventId, organizationId, userId, expiresAt, comment],
      );
      return r.rows[0];
    });
  }

  async resolveEvent(
    organizationId: string, eventId: string, userId: string | null, reason: string, autoResolved: boolean,
  ): Promise<AlertEventRow> {
    const r = await this.db.query<AlertEventRow>(
      `UPDATE alert_events
       SET status='resolved', resolved_by=$3, resolved_at=NOW(), ended_at=NOW(),
           resolution_reason=$4, next_escalation_at=NULL, auto_resolve_at=NULL
       WHERE id=$1 AND organization_id=$2 AND status NOT IN ('resolved')
       RETURNING *`,
      [eventId, organizationId, userId, reason.slice(0, 100)],
    );
    if (!r.rows[0]) throw new AlertNotFoundError('Unresolved alert event');
    return r.rows[0];
  }

  async insertHistory(input: {
    eventId: string; organizationId: string; action: string; actorId: string | null;
    actorType?: string; previousState?: Record<string, unknown> | null; newState?: Record<string, unknown> | null;
    changesSummary?: Record<string, unknown> | null; metadata?: Record<string, unknown>;
  }, client?: PoolClient): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `INSERT INTO alert_event_history
         (event_id, organization_id, action, actor_id, actor_type, previous_state, new_state, changes_summary, metadata)
       VALUES ($1,$2,$3::history_action,$4,$5,$6,$7,$8,$9)`,
      [
        input.eventId, input.organizationId, input.action, input.actorId, input.actorType ?? 'user',
        input.previousState ? JSON.stringify(input.previousState) : null,
        input.newState ? JSON.stringify(input.newState) : null,
        input.changesSummary ? JSON.stringify(input.changesSummary) : null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async getEventHistory(eventId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, action, actor_id, actor_type, previous_state, new_state, changes_summary, metadata, created_at
       FROM alert_event_history WHERE event_id=$1 ORDER BY created_at ASC`,
      [eventId],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getEventDeliveries(eventId: string): Promise<AlertDeliveryAttemptRow[]> {
    const r = await this.db.query<AlertDeliveryAttemptRow>(
      `SELECT * FROM alert_delivery_attempts WHERE event_id=$1 ORDER BY created_at DESC`, [eventId],
    );
    return r.rows;
  }

  // ── Batch lifecycle ──────────────────────────────────────────────────────
  /**
   * Atomically claim up to `limit` pending events for the org and enqueue them
   * as a single batch. SKIP LOCKED makes concurrent batch creation safe.
   */
  async createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null> {
    return this.withTransaction(async (client) => {
      const claimed = await client.query<{ id: string }>(
        `SELECT id FROM alert_events
         WHERE organization_id=$1 AND status='pending'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [organizationId, limit],
      );
      const ids = claimed.rows.map((r) => r.id);
      if (ids.length === 0) return null;

      await client.query(
        `UPDATE alert_events SET status='processing' WHERE id = ANY($1::uuid[])`, [ids],
      );
      const batch = await client.query<AlertBatchRow>(
        `INSERT INTO alert_event_batches (organization_id, status, event_ids, event_count, worker_id, started_at)
         VALUES ($1,'processing',$2,$3,$4,NOW()) RETURNING *`,
        [organizationId, ids, ids.length, workerId],
      );
      return batch.rows[0]!;
    });
  }

  /** Fetch a batch and ALL its events in a single round-trip (no N+1). */
  async getBatchWithEvents(
    batchId: string, organizationId: string,
  ): Promise<{ batch: AlertBatchRow; events: AlertEventRow[] } | null> {
    const batchRes = await this.db.query<AlertBatchRow>(
      `SELECT * FROM alert_event_batches WHERE id=$1 AND organization_id=$2`, [batchId, organizationId],
    );
    const batch = batchRes.rows[0];
    if (!batch) return null;

    const eventsRes = await this.db.query<AlertEventRow>(
      `SELECT * FROM alert_events WHERE id = ANY($1::uuid[]) AND organization_id=$2`,
      [batch.event_ids, organizationId],
    );
    return { batch, events: eventsRes.rows };
  }

  async completeBatch(
    batchId: string,
    counts: { success: number; failure: number; skipped: number },
    durationMs: number,
    status: 'completed' | 'partial' | 'failed',
    errorMessage: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alert_event_batches
       SET status=$2, success_count=$3, failure_count=$4, skipped_count=$5,
           duration_ms=$6, completed_at=NOW(), error_message=$7
       WHERE id=$1`,
      [batchId, status, counts.success, counts.failure, counts.skipped, durationMs, errorMessage],
    );
  }

  /**
   * Bulk-update event statuses in ONE statement via UNNEST. `last_notified_at`
   * is set for events that were delivered (status 'firing').
   */
  async bulkUpdateEventStatus(
    organizationId: string,
    updates: Array<{ id: string; status: AlertEventStatus }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.query(
      `UPDATE alert_events e
       SET status = u.status::alert_event_status,
           last_notified_at = CASE WHEN u.status='firing' THEN NOW() ELSE e.last_notified_at END
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[]) AS t(id, status)) u
       WHERE e.id = u.id AND e.organization_id = $3`,
      [updates.map((u) => u.id), updates.map((u) => u.status), organizationId],
    );
  }

  /** Bulk-insert delivery attempts in ONE statement via UNNEST. */
  async bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.query(
      `INSERT INTO alert_delivery_attempts
         (organization_id, event_id, connector_id, route_id, batch_id, status,
          response_status_code, error_message, error_category, latency_ms, external_message_id)
       SELECT t.organization_id, t.event_id, t.connector_id, t.route_id, t.batch_id,
              t.status::delivery_attempt_status, t.response_status_code, t.error_message,
              t.error_category, t.latency_ms, t.external_message_id
       FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::text[],
         $7::int[], $8::text[], $9::text[], $10::int[], $11::text[]
       ) AS t(organization_id, event_id, connector_id, route_id, batch_id, status,
              response_status_code, error_message, error_category, latency_ms, external_message_id)`,
      [
        rows.map((r) => r.organizationId),
        rows.map((r) => r.eventId),
        rows.map((r) => r.connectorId),
        rows.map((r) => r.routeId),
        rows.map((r) => r.batchId),
        rows.map((r) => r.status),
        rows.map((r) => r.responseStatusCode),
        rows.map((r) => r.errorMessage),
        rows.map((r) => r.errorCategory),
        rows.map((r) => r.latencyMs),
        rows.map((r) => r.externalMessageId),
      ],
    );
  }

  // ── Auto-resolve + escalation sweeps ─────────────────────────────────────
  /** Distinct org ids that currently have pending (un-batched) events. */
  async findOrgsWithPendingEvents(limit: number): Promise<string[]> {
    const r = await this.db.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM alert_events WHERE status='pending' LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => row.organization_id);
  }

  async claimAutoResolvable(limit: number): Promise<AlertEventRow[]> {
    return this.withTransaction(async (client) => {
      const r = await client.query<AlertEventRow>(
        `SELECT * FROM alert_events
         WHERE status='firing' AND auto_resolve_at IS NOT NULL AND auto_resolve_at <= NOW()
         ORDER BY auto_resolve_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return r.rows;
    });
  }

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
