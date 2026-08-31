/**
 * AlertRuntimeRepository — Log DB alert runtime (typed v2 tables).
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/02-data-model.md §3
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 1)
 *
 * ADR-0006: the Log DB owns runtime/event data and every runtime table is
 * append-oriented. `alert_event_state` is the ONE documented mutable projection.
 *
 * Boundary rules enforced by this file:
 *   - It NEVER imports config/database.js. The pool is injected, and it must be
 *     the Log DB pool (verified by assertRuntimePool at boot).
 *   - It contains NO business logic: no dedup decision, no cooldown decision, no
 *     routing, no entitlement checks. Those belong to the Policy Engine and the
 *     Decision Engine. This class is persistence only.
 *   - Writes are append-only INSERTs except upsertState/upsertRuleEvalState, which
 *     maintain the two documented mutable projections.
 *
 * Every write accepts an optional PoolClient so the Decision Engine can perform
 * its whole step inside ONE transaction (ADR-0007) without this class knowing why.
 */
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type {
  NotificationDeliveryMode,
  NotificationProvider,
  NotificationRecipientType,
} from './notification-entitlement.service.js';
import { assertAlertingPool, type AlertingPoolTarget } from './runtime-pool.js';

export type LogDbSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'fatal';
export type AlertEventKind = 'fired' | 'recovered' | 'duplicate' | 'suppressed' | 'silenced';
export type AlertStateValue =
  | 'healthy' | 'pending' | 'triggered' | 'firing' | 'acknowledged' | 'escalated'
  | 'resolved' | 'closed' | 'suppressed' | 'silenced' | 'expired' | 'error';
export type NotificationChannelKind =
  | 'in_app' | 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'webhook' | 'sms';
export type NotificationJobStatus =
  | 'pending' | 'queued' | 'sent' | 'failed' | 'suppressed' | 'cancelled' | 'expired';
export type AlertEngine = 'fast' | 'window' | 'reconcile' | 'api' | 'legacy';

export interface AppendAlertEventInput {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  ruleId?: string | null;
  bindingId?: string | null;
  ruleRevision?: number | null;
  kind: AlertEventKind;
  severity: LogDbSeverity;
  priority?: number;
  fingerprint: string;
  dedupKey: string;
  correlationKey?: string | null;
  groupKey?: string | null;
  source: string;
  engine: AlertEngine;
  idempotencyKey: string;
  observedValue?: number | null;
  thresholdValue?: number | null;
  evidence?: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
  labels?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  occurredAt: Date;
}

export interface AlertEventV2Row {
  id: string;
  organization_id: string;
  project_id: string | null;
  environment: string | null;
  service: string | null;
  endpoint: string | null;
  rule_id: string | null;
  binding_id: string | null;
  rule_revision: number | null;
  kind: AlertEventKind;
  severity: LogDbSeverity;
  priority: number;
  fingerprint: string;
  dedup_key: string;
  correlation_key: string | null;
  group_key: string | null;
  source: string;
  engine: AlertEngine;
  idempotency_key: string;
  observed_value: string | null;
  threshold_value: string | null;
  evidence: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  occurred_at: Date;
  created_at: Date;
}

export interface AlertEventStateRow {
  alert_key: string;
  organization_id: string;
  project_id: string | null;
  latest_event_id: string;
  state: AlertStateValue;
  severity: LogDbSeverity;
  duplicate_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  last_notified_at: Date | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  acknowledgment_expires_at: Date | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  auto_resolve_at: Date | null;
  escalation_policy_id: string | null;
  escalation_step_number: number;
  escalation_repeat_count: number;
  next_escalation_at: Date | null;
  incident_id: string | null;
  updated_at: Date;
}

export interface UpsertAlertStateInput {
  alertKey: string;
  organizationId: string;
  projectId?: string | null;
  latestEventId: string;
  state: AlertStateValue;
  severity: LogDbSeverity;
  seenAt: Date;
  notifiedAt?: Date | null;
  autoResolveAt?: Date | null;
  escalationPolicyId?: string | null;
  escalationStepNumber?: number;
  nextEscalationAt?: Date | null;
  incidentId?: string | null;
}

export interface AppendHistoryInput {
  organizationId: string;
  alertKey: string;
  alertEventId?: string | null;
  action: string;
  actorType?: 'user' | 'system' | 'worker' | 'api';
  actorUserId?: string | null;
  previousState?: AlertStateValue | null;
  newState?: AlertStateValue | null;
  changesSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Canonical alerting -> automation domain event.
 * See docs/automationv2/27-alerting-automation-event-contract.md for the full
 * contract and field derivation.
 */
export interface AppendDomainOutboxInput {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  alertKey: string;
  alertEventId: string;
  eventType: 'alert.event.created' | 'alert.event.resolved';
  /** `alert:{eventType}:{alert_events_v2.idempotency_key}` */
  dedupeKey: string;
  severity: LogDbSeverity;
  occurredAt: Date;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface NotificationJobInsert {
  organizationId: string;
  projectId?: string | null;
  alertEventId: string;
  alertKey: string;
  ruleId?: string | null;
  bindingId?: string | null;
  channelId?: string | null;
  channelKind: NotificationChannelKind;
  connectorId?: string | null;
  routeId?: string | null;
  recipientUserId?: string | null;
  recipientRef?: string | null;
  templateId?: string | null;
  notificationType?: string;
  severity: LogDbSeverity;
  priority?: number;
  escalationStep?: number;
  attemptEpoch?: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  billable?: boolean;
  notifyAfter?: Date | null;
  routingDecisionHash?: string | null;
  deliveryMode?: NotificationDeliveryMode | null;
  recipientType?: NotificationRecipientType | null;
  provider?: NotificationProvider | null;
}

export interface NotificationJobRow {
  id: string;
  created_at: Date;
  idempotency_key: string;
  channel_kind: NotificationChannelKind;
  status: NotificationJobStatus;
  recipient_user_id: string | null;
}

export interface NotificationJobDetailRow extends NotificationJobRow {
  organization_id: string;
  project_id: string | null;
  alert_event_id: string;
  alert_key: string;
  rule_id: string | null;
  binding_id: string | null;
  channel_id: string | null;
  connector_id: string | null;
  route_id: string | null;
  recipient_ref: string | null;
  template_id: string | null;
  notification_type: string;
  routing_decision_hash: string | null;
  delivery_mode: NotificationDeliveryMode | null;
  recipient_type: NotificationRecipientType | null;
  provider: NotificationProvider | null;
  severity: LogDbSeverity;
  priority: number;
  escalation_step: number;
  attempt_epoch: number;
  payload: Record<string, unknown>;
  billable: boolean;
  notify_after: Date | null;
}

export interface LedgerInsert {
  organizationId: string;
  ruleId?: string | null;
  ruleActionId?: string | null;
  bindingId?: string | null;
  alertKey: string;
  channelKind: NotificationChannelKind;
  recipientUserId?: string | null;
  notificationJobId?: string | null;
}

export interface DeliveryAttemptInsertV2 {
  organizationId: string;
  projectId?: string | null;
  alertEventId: string;
  notificationJobId: string;
  channelKind: NotificationChannelKind;
  connectorId?: string | null;
  routeId?: string | null;
  recipientUserId?: string | null;
  attemptNumber: number;
  status: NotificationJobStatus;
  responseStatusCode?: number | null;
  externalMessageId?: string | null;
  errorCategory?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
}

export interface RuleEvalStateRow {
  scope_hash: string;
  organization_id: string;
  rule_id: string;
  binding_id: string | null;
  consecutive_breaches: number;
  is_breaching: boolean;
  last_evaluated_at: Date | null;
  last_fired_at: Date | null;
  last_recovered_at: Date | null;
}

export interface UpsertRuleEvalStateInput {
  scopeHash: string;
  organizationId: string;
  ruleId: string;
  bindingId?: string | null;
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  consecutiveBreaches: number;
  isBreaching: boolean;
  evaluatedAt: Date;
  firedAt?: Date | null;
  recoveredAt?: Date | null;
}

/** Scope identity for an atomic evaluation-state transition. */
interface RuleEvalScopeIdentity {
  scopeHash: string;
  organizationId: string;
  ruleId: string;
  bindingId?: string | null;
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  evaluatedAt: Date;
}

export interface ClaimBreachDecisionInput extends RuleEvalScopeIdentity {
  /** Effective `consecutiveBreaches` required before firing (>= 1). */
  requiredBreaches: number;
  /** Effective cooldown in seconds (0 disables cooldown gating). */
  cooldownSeconds: number;
}

export interface ClaimRecoveryInput extends RuleEvalScopeIdentity {}

/** A row resolved by the auto-resolve sweep. */
export interface AutoResolvedAlertRow {
  alert_key: string;
  organization_id: string;
  project_id: string | null;
  latest_event_id: string;
  severity: LogDbSeverity;
}

export interface BreachDecision {
  consecutiveBreaches: number;
  /** True for exactly one caller per cooldown window. Authoritative fire gate. */
  fired: boolean;
  lastFiredAt: Date | null;
  /** True when state could not be determined; callers MUST NOT fire. */
  indeterminate: boolean;
}

/** Throttle inputs derived from the append-only ledger (replaces alert_throttle_windows). */
export interface ThrottleWindowState {
  ruleActionId: string;
  notificationCount: number;
  lastNotifiedAt: Date | null;
}

function json(value: Record<string, unknown> | undefined | null): string {
  return JSON.stringify(value ?? {});
}

export class AlertRuntimeRepository {
  /**
   * @param db The LOG DB pool (logDB.getPrimaryPool()). There is no default:
   *   defaulting would re-create the exact ambiguity ADR-0006 removes.
   */
  constructor(private readonly db: Pool) {}

  /** The pool this repository is bound to. Exposed for boot verification only. */
  get connectionPool(): Pool {
    return this.db;
  }

  /**
   * Boot assertion (ADR-0006): the runtime pool must resolve `events_requests`
   * (telemetry is visible) and `alert_events_v2` (Log DB migrations applied).
   */
  async assertRuntimePool(logger: Logger): Promise<AlertingPoolTarget> {
    return assertAlertingPool(this.db, 'alerting_runtime', logger);
  }

  /**
   * Runtime transaction. Scoped to the Log DB only — it can never span the control
   * plane, which is what makes the ADR-0006 boundary structural rather than advisory.
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private exec(client?: PoolClient): Pool | PoolClient {
    return client ?? this.db;
  }

  // ── alert_events_v2 (append-only) ───────────────────────────────────────────

  /**
   * Append an alert event.
   *
   * Returns `null` when `uq_alert_events_v2_idem` rejects the row, i.e. this exact
   * candidate was already decided. Callers treat null as "already handled" — that
   * is the exactly-once mechanism, and it lives in the index, not in code.
   */
  async appendEvent(
    input: AppendAlertEventInput,
    client?: PoolClient,
  ): Promise<AlertEventV2Row | null> {
    const result = await this.exec(client).query<AlertEventV2Row>(
      `WITH reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         VALUES ('alert_event', $1, $18)
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       )
       INSERT INTO alert_events_v2 (
         organization_id, project_id, environment, service, endpoint,
         rule_id, binding_id, rule_revision, kind, severity, priority,
         fingerprint, dedup_key, correlation_key, group_key, source, engine,
         idempotency_key, observed_value, threshold_value,
         evidence, policy_snapshot, labels, annotations, occurred_at
       )
       SELECT $1, $2, $3, $4, $5,
              $6, $7, $8, $9::alert_event_kind, $10::logdb_severity, $11,
              $12, $13, $14, $15, $16, $17,
              $18, $19, $20,
              $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb, $25
         FROM reserved
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.organizationId,
        input.projectId ?? null,
        input.environment ?? null,
        input.service ?? null,
        input.endpoint ?? null,
        input.ruleId ?? null,
        input.bindingId ?? null,
        input.ruleRevision ?? null,
        input.kind,
        input.severity,
        input.priority ?? 0,
        input.fingerprint,
        input.dedupKey,
        input.correlationKey ?? null,
        input.groupKey ?? null,
        input.source,
        input.engine,
        input.idempotencyKey,
        input.observedValue ?? null,
        input.thresholdValue ?? null,
        json(input.evidence),
        json(input.policySnapshot),
        json(input.labels),
        json(input.annotations),
        input.occurredAt,
      ],
    );
    return result.rows[0] ?? null;
  }

  async findEventById(
    organizationId: string,
    id: string,
    client?: PoolClient,
  ): Promise<AlertEventV2Row | null> {
    const result = await this.exec(client).query<AlertEventV2Row>(
      `SELECT * FROM alert_events_v2 WHERE id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [id, organizationId],
    );
    return result.rows[0] ?? null;
  }

  // ── alert_event_state (the ONE mutable projection) ──────────────────────────

  async getState(alertKey: string, client?: PoolClient): Promise<AlertEventStateRow | null> {
    const result = await this.exec(client).query<AlertEventStateRow>(
      `SELECT * FROM alert_event_state WHERE alert_key = $1`,
      [alertKey],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Lock the state row for the duration of the caller's transaction.
   *
   * ADR-0007 relies on this to serialize concurrent decisions for the same alert
   * key, so two workers evaluating the same rule in the same second cannot both
   * fire. Requires an explicit client: a lock outside a transaction is meaningless.
   */
  async lockState(client: PoolClient, alertKey: string): Promise<AlertEventStateRow | null> {
    const result = await client.query<AlertEventStateRow>(
      `SELECT * FROM alert_event_state WHERE alert_key = $1 FOR UPDATE`,
      [alertKey],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Insert or advance the alert state projection.
   *
   * `first_seen_at` is preserved on update; `last_seen_at` moves forward monotonically
   * so an out-of-order redelivery cannot rewind it. `duplicate_count` is untouched
   * here — {@link incrementDuplicate} owns it, keeping the two concerns separate.
   */
  async upsertState(input: UpsertAlertStateInput, client?: PoolClient): Promise<AlertEventStateRow> {
    const result = await this.exec(client).query<AlertEventStateRow>(
      `INSERT INTO alert_event_state (
         alert_key, organization_id, project_id, latest_event_id, state, severity,
         first_seen_at, last_seen_at, last_notified_at, auto_resolve_at,
         escalation_policy_id, escalation_step_number, next_escalation_at, incident_id
       ) VALUES (
         $1, $2, $3, $4, $5::alert_state, $6::logdb_severity,
         $7, $7, $8, $9, $10, $11, $12, $13
       )
       ON CONFLICT (alert_key) DO UPDATE SET
         latest_event_id        = EXCLUDED.latest_event_id,
         state                  = EXCLUDED.state,
         severity               = EXCLUDED.severity,
         last_seen_at           = GREATEST(alert_event_state.last_seen_at, EXCLUDED.last_seen_at),
         last_notified_at       = COALESCE(EXCLUDED.last_notified_at, alert_event_state.last_notified_at),
         auto_resolve_at        = EXCLUDED.auto_resolve_at,
         escalation_policy_id   = EXCLUDED.escalation_policy_id,
         escalation_step_number = EXCLUDED.escalation_step_number,
         next_escalation_at     = EXCLUDED.next_escalation_at,
         incident_id            = COALESCE(EXCLUDED.incident_id, alert_event_state.incident_id)
       RETURNING *`,
      [
        input.alertKey,
        input.organizationId,
        input.projectId ?? null,
        input.latestEventId,
        input.state,
        input.severity,
        input.seenAt,
        input.notifiedAt ?? null,
        input.autoResolveAt ?? null,
        input.escalationPolicyId ?? null,
        input.escalationStepNumber ?? 0,
        input.nextEscalationAt ?? null,
        input.incidentId ?? null,
      ],
    );
    return result.rows[0]!;
  }

  /** Fold a duplicate into the existing alert. Never billed (ADR-0010). */
  async incrementDuplicate(
    alertKey: string,
    seenAt: Date,
    client?: PoolClient,
  ): Promise<AlertEventStateRow | null> {
    const result = await this.exec(client).query<AlertEventStateRow>(
      `UPDATE alert_event_state
          SET duplicate_count = duplicate_count + 1,
              last_seen_at = GREATEST(last_seen_at, $2)
        WHERE alert_key = $1
        RETURNING *`,
      [alertKey, seenAt],
    );
    return result.rows[0] ?? null;
  }

  // ── alert_event_history_v2 (append-only) ────────────────────────────────────

  async appendHistory(input: AppendHistoryInput, client?: PoolClient): Promise<void> {
    await this.exec(client).query(
      `INSERT INTO alert_event_history_v2 (
         organization_id, alert_key, alert_event_id, action, actor_type, actor_user_id,
         previous_state, new_state, changes_summary, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::alert_state, $8::alert_state, $9::jsonb, $10::jsonb
       )`,
      [
        input.organizationId,
        input.alertKey,
        input.alertEventId ?? null,
        input.action,
        input.actorType ?? 'system',
        input.actorUserId ?? null,
        input.previousState ?? null,
        input.newState ?? null,
        json(input.changesSummary),
        json(input.metadata),
      ],
    );
  }

  /**
   * Append a durable alert domain event for the automation bridge.
   *
   * Storage note: this reuses `telemetry_outbox` (`signal_kind =
   * 'alert_domain_event'`, `fast_path = FALSE`) rather than a dedicated table.
   * A dedicated table was the original design (see
   * docs/automationv2/27-alerting-automation-event-contract.md) but the Log DB
   * is currently at its storage quota and cannot allocate new relations;
   * widening this table's existing CHECK constraint is a catalog-only change
   * that does not require new storage. `fast_path = FALSE` means
   * TelemetryOutboxRelay's own claim query (`WHERE fast_path = TRUE`) can never
   * see these rows — AlertDomainOutboxRelay claims by `signal_kind` instead, so
   * the two relays never compete for the same row.
   *
   * MUST be called with the same `client` as the enclosing
   * AlertDecisionEngine.decide() transaction, so the outbox row commits
   * atomically with alert_events_v2/alert_event_state/alert_event_history_v2.
   *
   * Idempotency: `event_id` carries the dedupe key (derived from
   * alert_events_v2.idempotency_key by the caller), reserved through the same
   * `alert_runtime_idempotency_keys` table telemetry_outbox already uses
   * (namespace 'telemetry_outbox', consistent with how that table already
   * dedupes on `signal_kind || ':' || event_id`) — so a re-delivered or
   * accidentally-duplicated call is a safe no-op.
   */
  async appendDomainOutbox(input: AppendDomainOutboxInput, client?: PoolClient): Promise<void> {
    await this.exec(client).query(
      `WITH reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         VALUES ('telemetry_outbox', $1, 'alert_domain_event:' || $2)
         ON CONFLICT DO NOTHING
         RETURNING 1
       )
       INSERT INTO telemetry_outbox (
         organization_id, project_id, environment, signal_kind, event_id,
         severity, fast_path, attributes, occurred_at
       )
       SELECT $1, $3, $4, 'alert_domain_event', $2,
              $5::logdb_severity, FALSE, $6::jsonb, $7
       WHERE EXISTS (SELECT 1 FROM reserved)
       ON CONFLICT DO NOTHING`,
      [
        input.organizationId,
        input.dedupeKey,
        input.projectId ?? null,
        input.environment ?? null,
        input.severity,
        JSON.stringify({
          eventType: input.eventType,
          alertKey: input.alertKey,
          alertEventId: input.alertEventId,
          dedupeKey: input.dedupeKey,
          payload: input.payload,
          metadata: input.metadata ?? {},
        }),
        input.occurredAt.toISOString(),
      ],
    );
  }

  async listProjectAlertEvents(
    organizationId: string,
    projectId: string,
    query: { status?: string; severity?: string; limit: number; offset: number },
  ): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
    const params: unknown[] = [organizationId, projectId];
    const where = ['e.organization_id = $1', 'e.project_id = $2'];
    if (query.status) {
      params.push(query.status);
      where.push(`s.state = $${params.length}`);
    }
    if (query.severity) {
      params.push(query.severity);
      where.push(`e.severity = $${params.length}::logdb_severity`);
    }
    const clause = where.join(' AND ');
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM alert_events_v2 e
         LEFT JOIN alert_event_state s ON s.latest_event_id = e.id
        WHERE ${clause}`,
      params,
    );
    const dataParams = [...params, Math.max(1, Math.min(query.limit, 100)), Math.max(0, query.offset)];
    const result = await this.db.query(
      `SELECT e.id, e.organization_id, e.project_id, e.environment, e.service, e.endpoint,
              e.rule_id, e.binding_id, e.rule_revision, e.kind, e.severity, e.priority,
              e.fingerprint, e.source, e.observed_value, e.threshold_value,
              e.evidence, e.policy_snapshot, e.labels, e.annotations, e.occurred_at,
              e.created_at, s.state, s.duplicate_count, s.first_seen_at, s.last_seen_at,
              s.last_notified_at, s.resolved_at, s.resolution_reason,
              COALESCE(notifications.items, '[]'::jsonb) AS notifications,
              COALESCE(deliveries.items, '[]'::jsonb) AS deliveries
         FROM alert_events_v2 e
         LEFT JOIN alert_event_state s ON s.latest_event_id = e.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', j.id, 'channelKind', j.channel_kind, 'status', j.status,
             'recipientUserId', j.recipient_user_id, 'recipientRef', j.recipient_ref,
             'createdAt', j.created_at
           ) ORDER BY j.created_at ASC) AS items
             FROM alert_notification_jobs j
            WHERE j.alert_event_id = e.id
         ) notifications ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', d.id, 'notificationJobId', d.notification_job_id,
             'status', d.status, 'attemptNumber', d.attempt_number,
             'errorCategory', d.error_category, 'latencyMs', d.latency_ms,
             'createdAt', d.created_at
           ) ORDER BY d.created_at ASC) AS items
             FROM alert_delivery_attempts_v2 d
            WHERE d.alert_event_id = e.id
         ) deliveries ON TRUE
        WHERE ${clause}
        ORDER BY e.occurred_at DESC, e.created_at DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return {
      data: result.rows as Array<Record<string, unknown>>,
      total: Number(count.rows[0]?.count ?? 0),
    };
  }

  async findProjectAlertEventById(
    organizationId: string,
    projectId: string,
    alertEventId: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.db.query(
      `SELECT e.id, e.organization_id, e.project_id, e.environment, e.service, e.endpoint,
              e.rule_id, e.binding_id, e.rule_revision, e.kind, e.severity, e.priority,
              e.fingerprint, e.source, e.observed_value, e.threshold_value,
              e.evidence, e.policy_snapshot, e.labels, e.annotations, e.occurred_at,
              e.created_at, s.state, s.duplicate_count, s.first_seen_at, s.last_seen_at,
              s.last_notified_at, s.resolved_at, s.resolution_reason,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', j.id, 'channelKind', j.channel_kind, 'status', j.status,
                'recipientUserId', j.recipient_user_id, 'recipientRef', j.recipient_ref,
                'createdAt', j.created_at
              ) ORDER BY j.created_at ASC) FROM alert_notification_jobs j
                WHERE j.alert_event_id = e.id), '[]'::jsonb) AS notifications,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', d.id, 'notificationJobId', d.notification_job_id,
                'status', d.status, 'attemptNumber', d.attempt_number,
                'errorCategory', d.error_category, 'latencyMs', d.latency_ms,
                'createdAt', d.created_at
              ) ORDER BY d.created_at ASC) FROM alert_delivery_attempts_v2 d
                WHERE d.alert_event_id = e.id), '[]'::jsonb) AS deliveries
         FROM alert_events_v2 e
         LEFT JOIN alert_event_state s ON s.latest_event_id = e.id
        WHERE e.id = $1 AND e.organization_id = $2 AND e.project_id = $3
        LIMIT 1`,
      [alertEventId, organizationId, projectId],
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }


  async listHistory(alertKey: string, limit = 200): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `SELECT id, action, actor_type, actor_user_id, previous_state, new_state,
              changes_summary, metadata, created_at
         FROM alert_event_history_v2
        WHERE alert_key = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [alertKey, Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  // ── alert_notification_jobs (append-only, unique idempotency key) ───────────

  /**
   * Bulk-insert notification jobs in ONE statement (no N+1).
   *
   * `ON CONFLICT DO NOTHING` against `uq_alert_notification_jobs_idem` is what
   * delivers the "zero duplicate notifications" success criterion: a retried
   * decision job cannot create a second job for the same
   * (alert, channel, recipient, escalation step, attempt epoch).
   *
   * Returns only the rows actually inserted, so the caller can publish exactly
   * those and count usage for exactly those.
   */
  async insertNotificationJobs(
    rows: NotificationJobInsert[],
    client?: PoolClient,
  ): Promise<NotificationJobRow[]> {
    if (rows.length === 0) return [];
    const result = await this.exec(client).query<NotificationJobRow>(
      `WITH input AS (
         SELECT t.*
           FROM UNNEST(
             $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
             $6::uuid[], $7::uuid[], $8::uuid[], $9::text[], $10::uuid[],
             $11::text[], $12::smallint[], $13::smallint[], $14::smallint[], $15::jsonb[],
             $16::text[], $17::boolean[], $18::timestamptz[], $19::uuid[], $20::uuid[],
             $21::uuid[], $22::text[], $23::text[], $24::text[], $25::text[], $26::text[]
           ) AS t(organization_id, project_id, alert_event_id, alert_key, channel_kind,
                  connector_id, route_id, recipient_user_id, recipient_ref, template_id,
                  severity, priority, escalation_step, attempt_epoch, payload,
                  idempotency_key, billable, notify_after, rule_id, binding_id, channel_id,
                  notification_type, routing_decision_hash, delivery_mode, recipient_type, provider)
       ), reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         SELECT 'notification_job', organization_id, idempotency_key
           FROM input
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       )
       INSERT INTO alert_notification_jobs (
         organization_id, project_id, alert_event_id, alert_key, channel_kind,
         connector_id, route_id, recipient_user_id, recipient_ref, template_id,
         severity, priority, escalation_step, attempt_epoch, payload,
         idempotency_key, billable, notify_after, rule_id, binding_id, channel_id,
         notification_type, routing_decision_hash, delivery_mode, recipient_type, provider
       )
       SELECT t.organization_id, t.project_id, t.alert_event_id, t.alert_key,
              t.channel_kind::notification_channel_kind,
              t.connector_id, t.route_id, t.recipient_user_id, t.recipient_ref, t.template_id,
              t.severity::logdb_severity, t.priority, t.escalation_step, t.attempt_epoch,
              t.payload, t.idempotency_key, t.billable, t.notify_after,
              t.rule_id, t.binding_id, t.channel_id, t.notification_type, t.routing_decision_hash,
              t.delivery_mode, t.recipient_type, t.provider
         FROM input t
         JOIN reserved r
           ON r.organization_id = t.organization_id
          AND r.idempotency_key = t.idempotency_key
       ON CONFLICT DO NOTHING
        RETURNING id, created_at, idempotency_key, channel_kind, status, recipient_user_id`,
      [
        rows.map((r) => r.organizationId),
        rows.map((r) => r.projectId ?? null),
        rows.map((r) => r.alertEventId),
        rows.map((r) => r.alertKey),
        rows.map((r) => r.channelKind),
        rows.map((r) => r.connectorId ?? null),
        rows.map((r) => r.routeId ?? null),
        rows.map((r) => r.recipientUserId ?? null),
        rows.map((r) => r.recipientRef ?? null),
        rows.map((r) => r.templateId ?? null),
        rows.map((r) => r.severity),
        rows.map((r) => r.priority ?? 0),
        rows.map((r) => r.escalationStep ?? 0),
        rows.map((r) => r.attemptEpoch ?? 0),
        rows.map((r) => JSON.stringify(r.payload)),
        rows.map((r) => r.idempotencyKey),
        rows.map((r) => r.billable ?? true),
        rows.map((r) => r.notifyAfter ?? null),
        rows.map((r) => r.ruleId ?? null),
        rows.map((r) => r.bindingId ?? null),
        rows.map((r) => r.channelId ?? null),
        rows.map((r) => r.notificationType ?? 'alert'),
        rows.map((r) => r.routingDecisionHash ?? null),
        rows.map((r) => r.deliveryMode ?? null),
        rows.map((r) => r.recipientType ?? null),
        rows.map((r) => r.provider ?? null),
      ],
    );
    return result.rows;
  }

  /**
   * Advance a notification job's status.
   *
   * This is the ONE alert-owned write a connector worker performs (ADR-0008 step 7):
   * status and usage only, never policy. Guarded so a late duplicate cannot move a
   * terminal job backwards.
   */
  async setNotificationJobStatus(
    jobId: string,
    status: NotificationJobStatus,
    client?: PoolClient,
  ): Promise<boolean> {
    const result = await this.exec(client).query(
      `UPDATE alert_notification_jobs
          SET status = $2::notification_job_status
        WHERE id = $1
          AND status NOT IN ('sent','failed','cancelled','expired')`,
      [jobId, status],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async recordNotificationDelivery(input: {
    organizationId: string;
    jobId: string;
    jobStatus: NotificationJobStatus;
    attemptStatus: NotificationJobStatus;
    responseStatusCode?: number | null;
    externalMessageId?: string | null;
    errorCategory?: string | null;
    errorMessage?: string | null;
    latencyMs?: number | null;
  }): Promise<boolean> {
    return this.withTransaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`alert-notification-delivery:${input.jobId}`],
      );
      const jobResult = await client.query<NotificationJobDetailRow>(
        `SELECT id, status, organization_id, project_id, alert_event_id, channel_kind,
                connector_id, route_id, recipient_user_id
           FROM alert_notification_jobs
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [input.jobId, input.organizationId],
      );
      const job = jobResult.rows[0];
      if (!job || ['sent', 'failed', 'cancelled', 'expired'].includes(job.status)) return false;

      const attemptResult = await client.query<{ next_attempt: number }>(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
           FROM alert_delivery_attempts_v2
          WHERE notification_job_id = $1`,
        [input.jobId],
      );
      const attemptNumber = Number(attemptResult.rows[0]?.next_attempt ?? 1);
      await this.setNotificationJobStatus(input.jobId, input.jobStatus, client);
      await this.appendDeliveryAttempts([{
        organizationId: job.organization_id,
        projectId: job.project_id,
        alertEventId: job.alert_event_id,
        notificationJobId: job.id,
        channelKind: job.channel_kind,
        connectorId: job.connector_id,
        routeId: job.route_id,
        recipientUserId: job.recipient_user_id,
        attemptNumber,
        status: input.attemptStatus,
        responseStatusCode: input.responseStatusCode ?? null,
        externalMessageId: input.externalMessageId ?? null,
        errorCategory: input.errorCategory ?? null,
        errorMessage: input.errorMessage ?? null,
        latencyMs: input.latencyMs ?? null,
      }], client);
      return true;
    });
  }

  async findNotificationJobById(
    jobId: string,
    client?: PoolClient,
  ): Promise<NotificationJobDetailRow | null> {
    const result = await this.exec(client).query<NotificationJobDetailRow>(
      `SELECT id, created_at, idempotency_key, channel_kind, status, recipient_user_id,
               organization_id, project_id, alert_event_id, alert_key,
               rule_id, binding_id, channel_id, connector_id, route_id,
               recipient_ref, template_id, notification_type, routing_decision_hash,
               delivery_mode, recipient_type, provider,
               severity, priority, escalation_step, attempt_epoch,
               payload, billable, notify_after
          FROM alert_notification_jobs
        WHERE id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  async claimDueNotificationJobs(limit = 100, client?: PoolClient): Promise<NotificationJobDetailRow[]> {
    const result = await this.exec(client).query<NotificationJobDetailRow>(
      `WITH claimed AS (
         SELECT id, created_at
           FROM alert_notification_jobs
          WHERE status = 'pending'
            AND (notify_after IS NULL OR notify_after <= NOW())
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE alert_notification_jobs j
          SET status = 'queued'
         FROM claimed
        WHERE j.id = claimed.id AND j.created_at = claimed.created_at
        RETURNING j.id, j.created_at, j.idempotency_key, j.channel_kind, j.status, j.recipient_user_id,
                  j.organization_id, j.project_id, j.alert_event_id, j.alert_key,
                  j.rule_id, j.binding_id, j.channel_id, j.connector_id, j.route_id,
                  j.recipient_ref, j.template_id, j.notification_type, j.routing_decision_hash,
                  j.delivery_mode, j.recipient_type, j.provider,
                  j.severity, j.priority, j.escalation_step, j.attempt_epoch,
                  j.payload, j.billable, j.notify_after`,
      [Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows;
  }

  // ── alert_notification_ledger (append-only; replaces throttle windows) ──────

  async appendLedger(rows: LedgerInsert[], client?: PoolClient): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.exec(client).query(
      `INSERT INTO alert_notification_ledger (
         organization_id, rule_id, rule_action_id, binding_id, alert_key,
         channel_kind, recipient_user_id, notification_job_id
       )
       SELECT t.organization_id, t.rule_id, t.rule_action_id, t.binding_id, t.alert_key,
              t.channel_kind::notification_channel_kind, t.recipient_user_id, t.notification_job_id
         FROM UNNEST(
           $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
           $6::text[], $7::uuid[], $8::uuid[]
         ) AS t(organization_id, rule_id, rule_action_id, binding_id, alert_key,
                channel_kind, recipient_user_id, notification_job_id)`,
      [
        rows.map((r) => r.organizationId),
        rows.map((r) => r.ruleId ?? null),
        rows.map((r) => r.ruleActionId ?? null),
        rows.map((r) => r.bindingId ?? null),
        rows.map((r) => r.alertKey),
        rows.map((r) => r.channelKind),
        rows.map((r) => r.recipientUserId ?? null),
        rows.map((r) => r.notificationJobId ?? null),
      ],
    );
    return result.rowCount ?? 0;
  }

  /**
   * Derive throttle state for rule actions from the append-only ledger.
   *
   * Replaces reading the old mutable `alert_throttle_windows` row (audit A3): one
   * grouped query returns both the per-window count and the last notification time,
   * which is everything the throttle predicate needs.
   */
  async getThrottleWindowStates(
    ruleActionIds: string[],
    windowSeconds: number,
    client?: PoolClient,
  ): Promise<ThrottleWindowState[]> {
    if (ruleActionIds.length === 0) return [];
    const result = await this.exec(client).query<{
      rule_action_id: string;
      notification_count: string;
      last_notified_at: Date | null;
    }>(
      `SELECT rule_action_id,
              COUNT(*)::text AS notification_count,
              MAX(notified_at) AS last_notified_at
         FROM alert_notification_ledger
        WHERE rule_action_id = ANY($1::uuid[])
          AND notified_at > now() - ($2::bigint * INTERVAL '1 second')
        GROUP BY rule_action_id`,
      [ruleActionIds, Math.max(1, Math.floor(windowSeconds))],
    );
    return result.rows.map((row) => ({
      ruleActionId: row.rule_action_id,
      notificationCount: Number(row.notification_count),
      lastNotifiedAt: row.last_notified_at,
    }));
  }

  // ── alert_delivery_attempts_v2 (append-only) ────────────────────────────────

  async appendDeliveryAttempts(
    rows: DeliveryAttemptInsertV2[],
    client?: PoolClient,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.exec(client).query(
      `WITH input AS (
         SELECT t.*
           FROM UNNEST(
             $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
             $6::uuid[], $7::uuid[], $8::uuid[], $9::smallint[], $10::text[],
             $11::int[], $12::text[], $13::text[], $14::text[], $15::int[]
           ) AS t(organization_id, project_id, alert_event_id, notification_job_id, channel_kind,
                  connector_id, route_id, recipient_user_id, attempt_number, status,
                  response_status_code, external_message_id, error_category, error_message, latency_ms)
       ), reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         SELECT 'delivery_attempt', organization_id,
                notification_job_id::text || ':' || attempt_number::text
           FROM input
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       )
       INSERT INTO alert_delivery_attempts_v2 (
         organization_id, project_id, alert_event_id, notification_job_id, channel_kind,
         connector_id, route_id, recipient_user_id, attempt_number, status,
         response_status_code, external_message_id, error_category, error_message, latency_ms
       )
       SELECT t.organization_id, t.project_id, t.alert_event_id, t.notification_job_id,
              t.channel_kind::notification_channel_kind,
              t.connector_id, t.route_id, t.recipient_user_id, t.attempt_number,
              t.status::notification_job_status,
              t.response_status_code, t.external_message_id, t.error_category,
              t.error_message, t.latency_ms
         FROM input t
         JOIN reserved r
           ON r.organization_id = t.organization_id
          AND r.idempotency_key = t.notification_job_id::text || ':' || t.attempt_number::text
       ON CONFLICT DO NOTHING`,
      [
        rows.map((r) => r.organizationId),
        rows.map((r) => r.projectId ?? null),
        rows.map((r) => r.alertEventId),
        rows.map((r) => r.notificationJobId),
        rows.map((r) => r.channelKind),
        rows.map((r) => r.connectorId ?? null),
        rows.map((r) => r.routeId ?? null),
        rows.map((r) => r.recipientUserId ?? null),
        rows.map((r) => r.attemptNumber),
        rows.map((r) => r.status),
        rows.map((r) => r.responseStatusCode ?? null),
        rows.map((r) => r.externalMessageId ?? null),
        rows.map((r) => r.errorCategory ?? null),
        rows.map((r) => r.errorMessage?.slice(0, 4000) ?? null),
        rows.map((r) => r.latencyMs ?? null),
      ],
    );
    return result.rowCount ?? 0;
  }

  async listDeliveryAttempts(alertEventId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `SELECT * FROM alert_delivery_attempts_v2
        WHERE alert_event_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [alertEventId, Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  // ── alert_acknowledgments_v2 (append-only audit trail) ─────────────────────

  async appendAcknowledgment(
    input: {
      organizationId: string;
      alertKey: string;
      alertEventId?: string | null;
      acknowledgedBy: string;
      expiresAt?: Date | null;
      comment?: string | null;
    },
    client?: PoolClient,
  ): Promise<void> {
    await this.exec(client).query(
      `INSERT INTO alert_acknowledgments_v2 (
         organization_id, alert_key, alert_event_id, acknowledged_by, expires_at, comment
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.organizationId,
        input.alertKey,
        input.alertEventId ?? null,
        input.acknowledgedBy,
        input.expiresAt ?? null,
        input.comment ?? null,
      ],
    );
  }

  // ── alert_metrics_v2 (append-only) ─────────────────────────────────────────

  async appendMetric(
    input: {
      organizationId: string;
      projectId?: string | null;
      ruleId?: string | null;
      metricName: string;
      metricValue: number;
      granularity?: 'minute' | 'hour' | 'day' | 'week' | 'month';
      bucket: Date;
      labels?: Record<string, unknown>;
    },
    client?: PoolClient,
  ): Promise<void> {
    await this.exec(client).query(
      `INSERT INTO alert_metrics_v2 (
         organization_id, project_id, rule_id, metric_name, metric_value,
         granularity, bucket, labels
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        input.organizationId,
        input.projectId ?? null,
        input.ruleId ?? null,
        input.metricName,
        input.metricValue,
        input.granularity ?? 'hour',
        input.bucket,
        json(input.labels),
      ],
    );
  }

  // ── alert_dead_letter_events_v2 (append-only) ─────────────────────────────

  async appendDeadLetter(
    input: {
      organizationId: string;
      sourceQueue: string;
      pgbossJobId?: string | null;
      alertEventId?: string | null;
      notificationJobId?: string | null;
      payload?: Record<string, unknown>;
      errorMessage?: string | null;
      attempts?: number;
      maxRetries?: number;
    },
    client?: PoolClient,
  ): Promise<void> {
    await this.exec(client).query(
      `INSERT INTO alert_dead_letter_events_v2 (
         organization_id, source_queue, pgboss_job_id, alert_event_id, notification_job_id,
         payload, error_message, attempts, max_retries
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        input.organizationId,
        input.sourceQueue.slice(0, 64),
        input.pgbossJobId ?? null,
        input.alertEventId ?? null,
        input.notificationJobId ?? null,
        json(input.payload),
        input.errorMessage?.slice(0, 4000) ?? null,
        input.attempts ?? 0,
        input.maxRetries ?? 3,
      ],
    );
  }

  // ── alert_rule_eval_state (evaluator breach/cooldown projection) ───────────

  async getRuleEvalStates(scopeHashes: string[]): Promise<RuleEvalStateRow[]> {
    if (scopeHashes.length === 0) return [];
    const result = await this.db.query<RuleEvalStateRow>(
      `SELECT scope_hash, organization_id, rule_id, binding_id, consecutive_breaches,
              is_breaching, last_evaluated_at, last_fired_at, last_recovered_at
         FROM alert_rule_eval_state
        WHERE scope_hash = ANY($1::text[])`,
      [scopeHashes],
    );
    return result.rows;
  }

  /**
   * Persist evaluator breach state.
   *
   * This is why the table exists: the previous implementation wrote
   * `alert_rules.metadata->>'consecutiveBreaches'` on every tick, i.e. a hot-row
   * write on a read-mostly CONFIG table in the control plane. At a 5s cadence that
   * is untenable, and it also violated ADR-0006.
   */
  /**
   * Atomically advance breach state and claim the right to fire for one evaluation scope.
   *
   * Correctness contract (ADR: alerting hardening):
   *   - The consecutive-breach counter is incremented **in the database**, never
   *     computed in the application from a stale read, so concurrent evaluations
   *     of the same scope cannot lose updates.
   *   - The cooldown gate is decided **in the same statement** from the row's
   *     previous `last_fired_at`, while that row is locked by the upsert. Exactly
   *     one concurrent evaluation can observe `fired = true` for a given cooldown
   *     window, so duplicate alerts are impossible even when Redis is unavailable.
   *
   * Structure: the `locked` CTE upserts the row (taking a row lock) and returns its
   * PREVIOUS counters; the outer UPDATE then applies the transition derived from
   * those previous values. Because both run in one statement they share one
   * transaction and one lock, eliminating the read-then-write race.
   */
  async claimBreachDecision(input: ClaimBreachDecisionInput, client?: PoolClient): Promise<BreachDecision> {
    const fireCondition = `(
      (CASE WHEN l.prev_breaching THEN l.prev_breaches + 1 ELSE 1 END) >= $10::int
      AND (
        $11::int <= 0
        OR l.prev_fired_at IS NULL
        OR l.prev_fired_at <= $9::timestamptz - ($11::int * INTERVAL '1 second')
      )
    )`;

    const result = await this.exec(client).query<{
      consecutive_breaches: number;
      fired: boolean;
      last_fired_at: Date | null;
    }>(
      `WITH locked AS (
         INSERT INTO alert_rule_eval_state (
           scope_hash, organization_id, rule_id, binding_id, project_id, environment,
           service, endpoint, consecutive_breaches, is_breaching, last_evaluated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, FALSE, $9)
         ON CONFLICT (scope_hash) DO UPDATE SET last_evaluated_at = $9
         RETURNING consecutive_breaches AS prev_breaches,
                   is_breaching         AS prev_breaching,
                   last_fired_at        AS prev_fired_at
       )
       UPDATE alert_rule_eval_state s
          SET consecutive_breaches = CASE WHEN l.prev_breaching THEN l.prev_breaches + 1 ELSE 1 END,
              is_breaching         = TRUE,
              last_evaluated_at    = $9,
              last_fired_at        = CASE WHEN ${fireCondition} THEN $9 ELSE s.last_fired_at END
         FROM locked l
        WHERE s.scope_hash = $1
       RETURNING s.consecutive_breaches,
                 ${fireCondition} AS fired,
                 s.last_fired_at`,
      [
        input.scopeHash,
        input.organizationId,
        input.ruleId,
        input.bindingId ?? null,
        input.projectId ?? null,
        input.environment ?? null,
        input.service ?? null,
        input.endpoint ?? null,
        input.evaluatedAt,
        // `consecutive_breaches` is a Postgres INTEGER column (32-bit, max
        // 2147483647). Callers that want to "advance the counter without ever
        // firing" (see engines.ts fast-path skip) pass Number.MAX_SAFE_INTEGER
        // (2^53-1), which overflows int4 and raises error 22003. Clamp to the
        // int4 max here so any such sentinel is representable, instead of
        // failing every evaluation tick.
        Math.min(2147483647, Math.max(1, input.requiredBreaches)),
        Math.max(0, input.cooldownSeconds),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      // Defensive: the outer UPDATE always matches the row the CTE just upserted.
      // Reaching here means the row vanished concurrently (manual delete/retention).
      // Fail closed - do not fire on an indeterminate state.
      return { consecutiveBreaches: 0, fired: false, lastFiredAt: null, indeterminate: true };
    }
    return {
      consecutiveBreaches: Number(row.consecutive_breaches),
      fired: row.fired === true,
      lastFiredAt: row.last_fired_at,
      indeterminate: false,
    };
  }

  /**
   * Claim and resolve alerts whose `auto_resolve_at` deadline has passed.
   *
   * Semantics: this is a TIMEOUT-based resolution, not a verified recovery. The
   * alert is closed because it stopped being re-asserted for the configured
   * window, so `resolution_reason` is set to 'auto_resolved' to distinguish it
   * from a real evaluated recovery (`recover` -> 'resolved').
   *
   * Correctness properties:
   *   - Concurrency-safe: `FOR UPDATE SKIP LOCKED` means two sweep workers (or
   *     two replicas) never claim the same row.
   *   - Idempotent: the same statement both selects on `state = 'firing' AND
   *     auto_resolve_at <= NOW()` and clears those predicates, so a replay
   *     cannot resolve the same alert twice or emit a duplicate history row.
   *   - Only `firing` alerts are eligible. An `acknowledged` alert is owned by a
   *     human; auto-resolving it would hide it from whoever is handling it.
   *   - Uses the existing partial index `idx_alert_event_state_autoresolve`
   *     (`(auto_resolve_at) WHERE state = 'firing' AND auto_resolve_at IS NOT
   *     NULL`) - the predicates below are chosen to match it, so no new index
   *     is required.
   *
   * `organizationId` is optional: the scheduled sweep runs across tenants (like
   * the escalation sweep), but callers may scope it for targeted use or tests.
   */
  async claimAutoResolvableAlerts(
    limit: number,
    organizationId?: string | null,
    client?: PoolClient,
  ): Promise<AutoResolvedAlertRow[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const result = await this.exec(client).query<AutoResolvedAlertRow>(
      `UPDATE alert_event_state s
          SET state             = 'resolved',
              resolved_at       = NOW(),
              resolution_reason = 'auto_resolved',
              auto_resolve_at   = NULL,
              next_escalation_at = NULL,
              updated_at        = NOW()
        WHERE s.alert_key IN (
          SELECT alert_key
            FROM alert_event_state
           WHERE state = 'firing'
             AND auto_resolve_at IS NOT NULL
             AND auto_resolve_at <= NOW()
             AND ($2::uuid IS NULL OR organization_id = $2::uuid)
           ORDER BY auto_resolve_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
       RETURNING s.alert_key,
                 s.organization_id,
                 s.project_id,
                 s.latest_event_id,
                 s.severity`,
      [boundedLimit, organizationId ?? null],
    );
    return result.rows;
  }

  /**
   * Atomically clear breach state for a scope and report whether this call is the
   * one that observed the breach->healthy edge (so exactly one recovery alert is
   * emitted even under concurrent evaluation).
   */
  async claimRecovery(input: ClaimRecoveryInput, client?: PoolClient): Promise<{ recovered: boolean }> {
    const result = await this.exec(client).query<{ recovered: boolean }>(
      `WITH locked AS (
         INSERT INTO alert_rule_eval_state (
           scope_hash, organization_id, rule_id, binding_id, project_id, environment,
           service, endpoint, consecutive_breaches, is_breaching, last_evaluated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, FALSE, $9)
         ON CONFLICT (scope_hash) DO UPDATE SET last_evaluated_at = $9
         RETURNING is_breaching AS prev_breaching
       )
       UPDATE alert_rule_eval_state s
          SET consecutive_breaches = 0,
              is_breaching         = FALSE,
              last_evaluated_at    = $9,
              last_recovered_at    = CASE WHEN l.prev_breaching THEN $9 ELSE s.last_recovered_at END
         FROM locked l
        WHERE s.scope_hash = $1
       RETURNING l.prev_breaching AS recovered`,
      [
        input.scopeHash,
        input.organizationId,
        input.ruleId,
        input.bindingId ?? null,
        input.projectId ?? null,
        input.environment ?? null,
        input.service ?? null,
        input.endpoint ?? null,
        input.evaluatedAt,
      ],
    );
    return { recovered: result.rows[0]?.recovered === true };
  }

  async upsertRuleEvalState(input: UpsertRuleEvalStateInput, client?: PoolClient): Promise<void> {
    await this.exec(client).query(
      `INSERT INTO alert_rule_eval_state (
         scope_hash, organization_id, rule_id, binding_id, project_id, environment,
         service, endpoint, consecutive_breaches, is_breaching,
         last_evaluated_at, last_fired_at, last_recovered_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (scope_hash) DO UPDATE SET
         consecutive_breaches = EXCLUDED.consecutive_breaches,
         is_breaching         = EXCLUDED.is_breaching,
         last_evaluated_at    = EXCLUDED.last_evaluated_at,
         last_fired_at        = COALESCE(EXCLUDED.last_fired_at, alert_rule_eval_state.last_fired_at),
         last_recovered_at    = COALESCE(EXCLUDED.last_recovered_at, alert_rule_eval_state.last_recovered_at)`,
      [
        input.scopeHash,
        input.organizationId,
        input.ruleId,
        input.bindingId ?? null,
        input.projectId ?? null,
        input.environment ?? null,
        input.service ?? null,
        input.endpoint ?? null,
        input.consecutiveBreaches,
        input.isBreaching,
        input.evaluatedAt,
        input.firedAt ?? null,
        input.recoveredAt ?? null,
      ],
    );
  }
}
