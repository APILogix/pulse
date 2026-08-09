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
import { type AlertingPoolTarget } from './runtime-pool.js';
export type LogDbSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'fatal';
export type AlertEventKind = 'fired' | 'recovered' | 'duplicate' | 'suppressed' | 'silenced';
export type AlertStateValue = 'healthy' | 'pending' | 'triggered' | 'firing' | 'acknowledged' | 'escalated' | 'resolved' | 'closed' | 'suppressed' | 'silenced' | 'expired' | 'error';
export type NotificationChannelKind = 'in_app' | 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'webhook' | 'sms';
export type NotificationJobStatus = 'pending' | 'queued' | 'sent' | 'failed' | 'suppressed' | 'cancelled' | 'expired';
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
/** Throttle inputs derived from the append-only ledger (replaces alert_throttle_windows). */
export interface ThrottleWindowState {
    ruleActionId: string;
    notificationCount: number;
    lastNotifiedAt: Date | null;
}
export declare class AlertRuntimeRepository {
    private readonly db;
    /**
     * @param db The LOG DB pool (logDB.getPrimaryPool()). There is no default:
     *   defaulting would re-create the exact ambiguity ADR-0006 removes.
     */
    constructor(db: Pool);
    /** The pool this repository is bound to. Exposed for boot verification only. */
    get connectionPool(): Pool;
    /**
     * Boot assertion (ADR-0006): the runtime pool must resolve `events_requests`
     * (telemetry is visible) and `alert_events_v2` (Log DB migrations applied).
     */
    assertRuntimePool(logger: Logger): Promise<AlertingPoolTarget>;
    /**
     * Runtime transaction. Scoped to the Log DB only — it can never span the control
     * plane, which is what makes the ADR-0006 boundary structural rather than advisory.
     */
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    private exec;
    /**
     * Append an alert event.
     *
     * Returns `null` when `uq_alert_events_v2_idem` rejects the row, i.e. this exact
     * candidate was already decided. Callers treat null as "already handled" — that
     * is the exactly-once mechanism, and it lives in the index, not in code.
     */
    appendEvent(input: AppendAlertEventInput, client?: PoolClient): Promise<AlertEventV2Row | null>;
    findEventById(organizationId: string, id: string, client?: PoolClient): Promise<AlertEventV2Row | null>;
    getState(alertKey: string, client?: PoolClient): Promise<AlertEventStateRow | null>;
    /**
     * Lock the state row for the duration of the caller's transaction.
     *
     * ADR-0007 relies on this to serialize concurrent decisions for the same alert
     * key, so two workers evaluating the same rule in the same second cannot both
     * fire. Requires an explicit client: a lock outside a transaction is meaningless.
     */
    lockState(client: PoolClient, alertKey: string): Promise<AlertEventStateRow | null>;
    /**
     * Insert or advance the alert state projection.
     *
     * `first_seen_at` is preserved on update; `last_seen_at` moves forward monotonically
     * so an out-of-order redelivery cannot rewind it. `duplicate_count` is untouched
     * here — {@link incrementDuplicate} owns it, keeping the two concerns separate.
     */
    upsertState(input: UpsertAlertStateInput, client?: PoolClient): Promise<AlertEventStateRow>;
    /** Fold a duplicate into the existing alert. Never billed (ADR-0010). */
    incrementDuplicate(alertKey: string, seenAt: Date, client?: PoolClient): Promise<AlertEventStateRow | null>;
    appendHistory(input: AppendHistoryInput, client?: PoolClient): Promise<void>;
    listProjectAlertEvents(organizationId: string, projectId: string, query: {
        status?: string;
        severity?: string;
        limit: number;
        offset: number;
    }): Promise<{
        data: Array<Record<string, unknown>>;
        total: number;
    }>;
    findProjectAlertEventById(organizationId: string, projectId: string, alertEventId: string): Promise<Record<string, unknown> | null>;
    listHistory(alertKey: string, limit?: number): Promise<Array<Record<string, unknown>>>;
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
    insertNotificationJobs(rows: NotificationJobInsert[], client?: PoolClient): Promise<NotificationJobRow[]>;
    /**
     * Advance a notification job's status.
     *
     * This is the ONE alert-owned write a connector worker performs (ADR-0008 step 7):
     * status and usage only, never policy. Guarded so a late duplicate cannot move a
     * terminal job backwards.
     */
    setNotificationJobStatus(jobId: string, status: NotificationJobStatus, client?: PoolClient): Promise<boolean>;
    recordNotificationDelivery(input: {
        organizationId: string;
        jobId: string;
        jobStatus: NotificationJobStatus;
        attemptStatus: NotificationJobStatus;
        responseStatusCode?: number | null;
        externalMessageId?: string | null;
        errorCategory?: string | null;
        errorMessage?: string | null;
        latencyMs?: number | null;
    }): Promise<boolean>;
    findNotificationJobById(jobId: string, client?: PoolClient): Promise<NotificationJobDetailRow | null>;
    claimDueNotificationJobs(limit?: number, client?: PoolClient): Promise<NotificationJobDetailRow[]>;
    appendLedger(rows: LedgerInsert[], client?: PoolClient): Promise<number>;
    /**
     * Derive throttle state for rule actions from the append-only ledger.
     *
     * Replaces reading the old mutable `alert_throttle_windows` row (audit A3): one
     * grouped query returns both the per-window count and the last notification time,
     * which is everything the throttle predicate needs.
     */
    getThrottleWindowStates(ruleActionIds: string[], windowSeconds: number, client?: PoolClient): Promise<ThrottleWindowState[]>;
    appendDeliveryAttempts(rows: DeliveryAttemptInsertV2[], client?: PoolClient): Promise<number>;
    listDeliveryAttempts(alertEventId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    appendAcknowledgment(input: {
        organizationId: string;
        alertKey: string;
        alertEventId?: string | null;
        acknowledgedBy: string;
        expiresAt?: Date | null;
        comment?: string | null;
    }, client?: PoolClient): Promise<void>;
    appendMetric(input: {
        organizationId: string;
        projectId?: string | null;
        ruleId?: string | null;
        metricName: string;
        metricValue: number;
        granularity?: 'minute' | 'hour' | 'day' | 'week' | 'month';
        bucket: Date;
        labels?: Record<string, unknown>;
    }, client?: PoolClient): Promise<void>;
    appendDeadLetter(input: {
        organizationId: string;
        sourceQueue: string;
        pgbossJobId?: string | null;
        alertEventId?: string | null;
        notificationJobId?: string | null;
        payload?: Record<string, unknown>;
        errorMessage?: string | null;
        attempts?: number;
        maxRetries?: number;
    }, client?: PoolClient): Promise<void>;
    getRuleEvalStates(scopeHashes: string[]): Promise<RuleEvalStateRow[]>;
    /**
     * Persist evaluator breach state.
     *
     * This is why the table exists: the previous implementation wrote
     * `alert_rules.metadata->>'consecutiveBreaches'` on every tick, i.e. a hot-row
     * write on a read-mostly CONFIG table in the control plane. At a 5s cadence that
     * is untenable, and it also violated ADR-0006.
     */
    upsertRuleEvalState(input: UpsertRuleEvalStateInput, client?: PoolClient): Promise<void>;
}
//# sourceMappingURL=alert-runtime.repository.d.ts.map