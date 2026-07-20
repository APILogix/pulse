import type { PoolClient } from 'pg';
export * from './rules/rules.repository.js';
export * from './events/events.repository.js';
export * from './silences/silences.repository.js';
export * from './policies/policies.repository.js';
export * from './templates/templates.repository.js';
export * from './routing/routing.repository.js';
export * from './metrics/metrics.repository.js';
import type { CreateRuleInput, RuleConditionInsert, RuleActionInsert } from './rules/rules.repository.js';
import type { InsertEventInput, DeliveryAttemptInsert } from './events/events.repository.js';
import type { AlertRuleRow, AlertRuleConditionRow, AlertRuleActionRow, AlertEventRow, AlertDeliveryAttemptRow, AlertBatchRow, AlertSilenceRow, AlertEscalationPolicyRow, AlertEscalationStepRow, AlertTemplateRow, AlertRoutingRuleRow, AlertMetricRow, AlertDeadLetterRow, AlertThrottleWindowRow, ListRulesQuery, ListEventsQuery, ListDeadLettersQuery, AlertEventStatus, MetricGranularity } from './types.js';
export declare class AlertingRepository {
    private rules;
    private events;
    private silences;
    private policies;
    private templates;
    private routing;
    private metrics;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createRule(input: CreateRuleInput): Promise<AlertRuleRow>;
    findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null>;
    getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]>;
    getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]>;
    getRuleActionsByRuleIds(ruleIds: string[]): Promise<AlertRuleActionRow[]>;
    listRules(organizationId: string, query: ListRulesQuery): Promise<{
        data: AlertRuleRow[];
        total: number;
    }>;
    updateRule(organizationId: string, id: string, fields: Record<string, unknown>, conditions: RuleConditionInsert[] | null, actions: RuleActionInsert[] | null, updatedBy: string): Promise<AlertRuleRow>;
    softDeleteRule(organizationId: string, id: string): Promise<void>;
    setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow>;
    findActiveEventByFingerprint(organizationId: string, fingerprint: string, windowSeconds: number, projectId?: string | null): Promise<AlertEventRow | null>;
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
    createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null>;
    getBatchWithEvents(batchId: string, organizationId: string): Promise<{
        batch: AlertBatchRow;
        events: AlertEventRow[];
    } | null>;
    completeBatch(batchId: string, counts: {
        success: number;
        failure: number;
        skipped: number;
    }, durationMs: number, status: 'completed' | 'partial' | 'failed', errorMessage: string | null): Promise<void>;
    bulkUpdateEventStatus(organizationId: string, updates: Array<{
        id: string;
        status: AlertEventStatus;
        escalationPolicyId?: string | null;
        escalationStepNumber?: number | null;
        nextEscalationAt?: Date | null;
    }>): Promise<void>;
    bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void>;
    findOrgsWithPendingEvents(limit: number): Promise<string[]>;
    claimAutoResolvable(limit: number): Promise<AlertEventRow[]>;
    claimEscalationDue(limit: number): Promise<AlertEventRow[]>;
    advanceEscalation(eventId: string, stepNumber: number, repeatCount: number, nextEscalationAt: Date | null): Promise<void>;
    resumeExpiredAcknowledgments(limit: number): Promise<AlertEventRow[]>;
    requeueStuckProcessingEvents(staleMinutes: number, limit: number): Promise<AlertEventRow[]>;
    failStaleBatches(staleMinutes: number): Promise<number>;
    setBatchJobId(batchId: string, jobId: string | null): Promise<void>;
    getThrottleStates(actionIds: string[]): Promise<AlertThrottleWindowRow[]>;
    recordThrottleNotifications(actionIds: string[]): Promise<void>;
    insertDeadLetter(input: {
        organizationId: string;
        sourceQueue: string;
        pgBossJobId: string | null;
        batchId: string | null;
        eventIds: string[];
        jobPayload: Record<string, unknown>;
        errorMessage: string | null;
        maxRetries: number;
    }): Promise<AlertDeadLetterRow>;
    listDeadLetters(organizationId: string, query: ListDeadLettersQuery): Promise<{
        data: AlertDeadLetterRow[];
        total: number;
    }>;
    findDeadLetterById(organizationId: string, id: string): Promise<AlertDeadLetterRow | null>;
    claimRetryableDeadLetters(limit: number): Promise<AlertDeadLetterRow[]>;
    markDeadLetterRetried(id: string): Promise<void>;
    markDeadLetterExhausted(id: string): Promise<void>;
    discardDeadLetter(organizationId: string, id: string, userId: string): Promise<void>;
    purgeOldTerminalEvents(days: number): Promise<number>;
    purgeOldBatches(days: number): Promise<number>;
    purgeOldDeliveryAttempts(days: number): Promise<number>;
    purgeOldDeadLetters(days: number): Promise<number>;
    purgeOldThrottleWindows(): Promise<number>;
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
    listEscalationStepsByPolicyIds(policyIds: string[]): Promise<AlertEscalationStepRow[]>;
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
    getRealtimeStats(organizationId: string): Promise<{
        firing: number;
        acknowledged: number;
        resolvedLast24h: number;
        mttrSeconds: number | null;
        mttaSeconds: number | null;
    }>;
}
//# sourceMappingURL=repository.d.ts.map