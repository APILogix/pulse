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
import { type AlertBatchRow, type AlertDeliveryAttemptRow, type AlertEscalationPolicyRow, type AlertEscalationStepRow, type AlertEventRow, type AlertEventStatus, type AlertMetricRow, type AlertRoutingRuleRow, type AlertRuleActionRow, type AlertRuleConditionRow, type AlertRuleRow, type AlertSilenceRow, type AlertTemplateRow, type DeliveryAttemptStatus, type ListEventsQuery, type ListRulesQuery, type MetricGranularity } from './types.js';
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
export declare class AlertingRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createRule(input: CreateRuleInput): Promise<AlertRuleRow>;
    private insertConditions;
    private insertActions;
    findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null>;
    getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]>;
    getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]>;
    listRules(organizationId: string, query: ListRulesQuery): Promise<{
        data: AlertRuleRow[];
        total: number;
    }>;
    /** Replace a rule's scalar fields and (optionally) its conditions/actions. */
    updateRule(organizationId: string, id: string, fields: Record<string, unknown>, conditions: RuleConditionInsert[] | null, actions: RuleActionInsert[] | null, updatedBy: string): Promise<AlertRuleRow>;
    softDeleteRule(organizationId: string, id: string): Promise<void>;
    setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow>;
    /** Find an active (firing/acknowledged) event matching a fingerprint within the dedup window. */
    findActiveEventByFingerprint(organizationId: string, fingerprint: string, windowSeconds: number): Promise<AlertEventRow | null>;
    incrementDuplicate(eventId: string): Promise<AlertEventRow>;
    insertEvent(input: InsertEventInput): Promise<AlertEventRow>;
    findEventById(organizationId: string, id: string): Promise<AlertEventRow | null>;
    listEvents(organizationId: string, query: ListEventsQuery): Promise<{
        data: AlertEventRow[];
        total: number;
    }>;
    acknowledgeEvent(organizationId: string, eventId: string, userId: string, expiresAt: Date | null, comment: string | null): Promise<AlertEventRow>;
    resolveEvent(organizationId: string, eventId: string, userId: string | null, reason: string, autoResolved: boolean): Promise<AlertEventRow>;
    insertHistory(input: {
        eventId: string;
        organizationId: string;
        action: string;
        actorId: string | null;
        actorType?: string;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        changesSummary?: Record<string, unknown> | null;
        metadata?: Record<string, unknown>;
    }, client?: PoolClient): Promise<void>;
    getEventHistory(eventId: string): Promise<Array<Record<string, unknown>>>;
    getEventDeliveries(eventId: string): Promise<AlertDeliveryAttemptRow[]>;
    /**
     * Atomically claim up to `limit` pending events for the org and enqueue them
     * as a single batch. SKIP LOCKED makes concurrent batch creation safe.
     */
    createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null>;
    /** Fetch a batch and ALL its events in a single round-trip (no N+1). */
    getBatchWithEvents(batchId: string, organizationId: string): Promise<{
        batch: AlertBatchRow;
        events: AlertEventRow[];
    } | null>;
    completeBatch(batchId: string, counts: {
        success: number;
        failure: number;
        skipped: number;
    }, durationMs: number, status: 'completed' | 'partial' | 'failed', errorMessage: string | null): Promise<void>;
    /**
     * Bulk-update event statuses in ONE statement via UNNEST. `last_notified_at`
     * is set for events that were delivered (status 'firing').
     */
    bulkUpdateEventStatus(organizationId: string, updates: Array<{
        id: string;
        status: AlertEventStatus;
    }>): Promise<void>;
    /** Bulk-insert delivery attempts in ONE statement via UNNEST. */
    bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void>;
    /** Distinct org ids that currently have pending (un-batched) events. */
    findOrgsWithPendingEvents(limit: number): Promise<string[]>;
    claimAutoResolvable(limit: number): Promise<AlertEventRow[]>;
    createSilence(input: {
        organizationId: string;
        ruleId: string | null;
        createdBy: string;
        comment: string | null;
        startsAt: Date;
        endsAt: Date;
        matchers: Record<string, unknown>;
    }): Promise<AlertSilenceRow>;
    listSilences(organizationId: string, active: boolean | undefined, limit: number, offset: number): Promise<{
        data: AlertSilenceRow[];
        total: number;
    }>;
    expireSilence(organizationId: string, id: string): Promise<void>;
    /** Active silences applicable to a rule (rule-specific or global) right now. */
    findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]>;
    createEscalationPolicy(input: {
        organizationId: string;
        name: string;
        description: string | null;
        repeatIntervalMinutes: number | null;
        maxRepeats: number;
        isActive: boolean;
    }): Promise<AlertEscalationPolicyRow>;
    listEscalationPolicies(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertEscalationPolicyRow[];
        total: number;
    }>;
    findEscalationPolicy(organizationId: string, id: string): Promise<AlertEscalationPolicyRow | null>;
    deleteEscalationPolicy(organizationId: string, id: string): Promise<void>;
    upsertEscalationStep(policyId: string, input: {
        stepNumber: number;
        waitMinutes: number;
        connectorIds: string[];
        routeIds: string[];
        notifyOnCall: boolean;
        customMessageTemplate: string | null;
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertEscalationStepRow>;
    listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]>;
    createTemplate(input: {
        organizationId: string;
        name: string;
        templateType: string;
        content: string;
        variablesSchema: unknown[];
        defaultForSeverity: string | null;
        connectorType: string | null;
        isDefault: boolean;
        sampleData: Record<string, unknown>;
    }): Promise<AlertTemplateRow>;
    findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null>;
    listTemplates(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertTemplateRow[];
        total: number;
    }>;
    deleteTemplate(organizationId: string, id: string): Promise<void>;
    createRoutingRule(input: {
        organizationId: string;
        name: string;
        description: string | null;
        priority: number;
        conditions: Record<string, unknown>;
        targetConnectorIds: string[];
        targetRouteIds: string[];
        fallbackConnectorIds: string[];
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertRoutingRuleRow>;
    listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]>;
    findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null>;
    deleteRoutingRule(organizationId: string, id: string): Promise<void>;
    queryMetrics(organizationId: string, filters: {
        metricType?: string;
        ruleId?: string;
        granularity: MetricGranularity;
        from?: Date;
        to?: Date;
        limit: number;
    }): Promise<AlertMetricRow[]>;
    /** Real-time dashboard stats computed directly from alert_events. */
    getRealtimeStats(organizationId: string): Promise<{
        firing: number;
        acknowledged: number;
        resolvedLast24h: number;
        mttrSeconds: number | null;
        mttaSeconds: number | null;
    }>;
}
//# sourceMappingURL=repository.d.ts.map