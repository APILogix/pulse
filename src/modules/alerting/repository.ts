import type { PoolClient } from 'pg';
import { RulesRepository } from './rules/rules.repository.js';
import { EventsRepository } from './events/events.repository.js';
import { SilencesRepository } from './silences/silences.repository.js';
import { PoliciesRepository } from './policies/policies.repository.js';
import { TemplatesRepository } from './templates/templates.repository.js';
import { RoutingRepository } from './routing/routing.repository.js';
import { MetricsRepository } from './metrics/metrics.repository.js';

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

export class AlertingRepository {

    private rules = new RulesRepository();
    private events = new EventsRepository();
    private silences = new SilencesRepository();
    private policies = new PoliciesRepository();
    private templates = new TemplatesRepository();
    private routing = new RoutingRepository();
    private metrics = new MetricsRepository();

    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        return this.rules.withTransaction(fn);
    }

    async createRule(input: CreateRuleInput): Promise<AlertRuleRow> {
        return this.rules.createRule(input);
    }

    async findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null> {
        return this.rules.findRuleById(organizationId, id);
    }

    async getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]> {
        return this.rules.getRuleConditions(ruleId);
    }

    async getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]> {
        return this.rules.getRuleActions(ruleId);
    }

    async getRuleActionsByRuleIds(ruleIds: string[]): Promise<AlertRuleActionRow[]> {
        return this.rules.getRuleActionsByRuleIds(ruleIds);
    }

    async listRules(organizationId: string, query: ListRulesQuery): Promise<{ data: AlertRuleRow[]; total: number }> {
        return this.rules.listRules(organizationId, query);
    }

    async updateRule(organizationId: string, id: string, fields: Record<string, unknown>, conditions: RuleConditionInsert[] | null, actions: RuleActionInsert[] | null, updatedBy: string): Promise<AlertRuleRow> {
        return this.rules.updateRule(organizationId, id, fields, conditions, actions, updatedBy);
    }

    async softDeleteRule(organizationId: string, id: string): Promise<void> {
        return this.rules.softDeleteRule(organizationId, id);
    }

    async setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow> {
        return this.rules.setRuleEnabled(organizationId, id, enabled);
    }

    async findActiveEventByFingerprint(organizationId: string, fingerprint: string, windowSeconds: number): Promise<AlertEventRow | null> {
        return this.events.findActiveEventByFingerprint(organizationId, fingerprint, windowSeconds);
    }

    async incrementDuplicate(eventId: string): Promise<AlertEventRow> {
        return this.events.incrementDuplicate(eventId);
    }

    async insertEvent(input: InsertEventInput): Promise<AlertEventRow> {
        return this.events.insertEvent(input);
    }

    async findEventById(organizationId: string, id: string): Promise<AlertEventRow | null> {
        return this.events.findEventById(organizationId, id);
    }

    async listEvents(organizationId: string, query: ListEventsQuery): Promise<{ data: AlertEventRow[]; total: number }> {
        return this.events.listEvents(organizationId, query);
    }

    async acknowledgeEvent(organizationId: string, eventId: string, userId: string, expiresAt: Date | null, comment: string | null): Promise<AlertEventRow> {
        return this.events.acknowledgeEvent(organizationId, eventId, userId, expiresAt, comment);
    }

    async resolveEvent(organizationId: string, eventId: string, userId: string | null, reason: string, autoResolved: boolean): Promise<AlertEventRow> {
        return this.events.resolveEvent(organizationId, eventId, userId, reason, autoResolved);
    }

    async insertHistory(input: {
    eventId: string; organizationId: string; action: string; actorId: string | null;
    actorType?: string; previousState?: Record<string, unknown> | null; newState?: Record<string, unknown> | null;
    changesSummary?: Record<string, unknown> | null; metadata?: Record<string, unknown>;
  }, client?: PoolClient): Promise<void> {
        return this.events.insertHistory(input, client);
    }

    async getEventHistory(eventId: string): Promise<Array<Record<string, unknown>>> {
        return this.events.getEventHistory(eventId);
    }

    async getEventDeliveries(eventId: string): Promise<AlertDeliveryAttemptRow[]> {
        return this.events.getEventDeliveries(eventId);
    }

    async createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null> {
        return this.events.createBatchFromPending(organizationId, limit, workerId);
    }

    async getBatchWithEvents(batchId: string, organizationId: string): Promise<{ batch: AlertBatchRow; events: AlertEventRow[] } | null> {
        return this.events.getBatchWithEvents(batchId, organizationId);
    }

    async completeBatch(batchId: string, counts: { success: number; failure: number; skipped: number }, durationMs: number, status: 'completed' | 'partial' | 'failed', errorMessage: string | null): Promise<void> {
        return this.events.completeBatch(batchId, counts, durationMs, status, errorMessage);
    }

    async bulkUpdateEventStatus(organizationId: string, updates: Array<{ id: string; status: AlertEventStatus; escalationPolicyId?: string | null; escalationStepNumber?: number | null; nextEscalationAt?: Date | null }>): Promise<void> {
        return this.events.bulkUpdateEventStatus(organizationId, updates);
    }

    async bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void> {
        return this.events.bulkInsertDeliveryAttempts(rows);
    }

    async findOrgsWithPendingEvents(limit: number): Promise<string[]> {
        return this.events.findOrgsWithPendingEvents(limit);
    }

    async claimAutoResolvable(limit: number): Promise<AlertEventRow[]> {
        return this.events.claimAutoResolvable(limit);
    }

    async claimEscalationDue(limit: number): Promise<AlertEventRow[]> {
        return this.events.claimEscalationDue(limit);
    }

    async advanceEscalation(eventId: string, stepNumber: number, repeatCount: number, nextEscalationAt: Date | null): Promise<void> {
        return this.events.advanceEscalation(eventId, stepNumber, repeatCount, nextEscalationAt);
    }

    async resumeExpiredAcknowledgments(limit: number): Promise<AlertEventRow[]> {
        return this.events.resumeExpiredAcknowledgments(limit);
    }

    async requeueStuckProcessingEvents(staleMinutes: number, limit: number): Promise<AlertEventRow[]> {
        return this.events.requeueStuckProcessingEvents(staleMinutes, limit);
    }

    async failStaleBatches(staleMinutes: number): Promise<number> {
        return this.events.failStaleBatches(staleMinutes);
    }

    async setBatchJobId(batchId: string, jobId: string | null): Promise<void> {
        return this.events.setBatchJobId(batchId, jobId);
    }

    async getThrottleStates(actionIds: string[]): Promise<AlertThrottleWindowRow[]> {
        return this.events.getThrottleStates(actionIds);
    }

    async recordThrottleNotifications(actionIds: string[]): Promise<void> {
        return this.events.recordThrottleNotifications(actionIds);
    }

    async insertDeadLetter(input: {
        organizationId: string; sourceQueue: string; pgBossJobId: string | null; batchId: string | null;
        eventIds: string[]; jobPayload: Record<string, unknown>; errorMessage: string | null; maxRetries: number;
    }): Promise<AlertDeadLetterRow> {
        return this.events.insertDeadLetter(input);
    }

    async listDeadLetters(organizationId: string, query: ListDeadLettersQuery): Promise<{ data: AlertDeadLetterRow[]; total: number }> {
        return this.events.listDeadLetters(organizationId, query);
    }

    async findDeadLetterById(organizationId: string, id: string): Promise<AlertDeadLetterRow | null> {
        return this.events.findDeadLetterById(organizationId, id);
    }

    async claimRetryableDeadLetters(limit: number): Promise<AlertDeadLetterRow[]> {
        return this.events.claimRetryableDeadLetters(limit);
    }

    async markDeadLetterRetried(id: string): Promise<void> {
        return this.events.markDeadLetterRetried(id);
    }

    async markDeadLetterExhausted(id: string): Promise<void> {
        return this.events.markDeadLetterExhausted(id);
    }

    async discardDeadLetter(organizationId: string, id: string, userId: string): Promise<void> {
        return this.events.discardDeadLetter(organizationId, id, userId);
    }

    async purgeOldTerminalEvents(days: number): Promise<number> {
        return this.events.purgeOldTerminalEvents(days);
    }

    async purgeOldBatches(days: number): Promise<number> {
        return this.events.purgeOldBatches(days);
    }

    async purgeOldDeliveryAttempts(days: number): Promise<number> {
        return this.events.purgeOldDeliveryAttempts(days);
    }

    async purgeOldDeadLetters(days: number): Promise<number> {
        return this.events.purgeOldDeadLetters(days);
    }

    async purgeOldThrottleWindows(): Promise<number> {
        return this.events.purgeOldThrottleWindows();
    }

    async createSilence(input: {
    organizationId: string; ruleId: string | null; createdBy: string; comment: string | null;
    startsAt: Date; endsAt: Date; matchers: Record<string, unknown>;
  }): Promise<AlertSilenceRow> {
        return this.silences.createSilence(input);
    }

    async listSilences(organizationId: string, active: boolean | undefined, limit: number, offset: number): Promise<{ data: AlertSilenceRow[]; total: number }> {
        return this.silences.listSilences(organizationId, active, limit, offset);
    }

    async expireSilence(organizationId: string, id: string): Promise<void> {
        return this.silences.expireSilence(organizationId, id);
    }

    async findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]> {
        return this.silences.findActiveSilences(organizationId, ruleId);
    }

    async createEscalationPolicy(input: {
    organizationId: string; name: string; description: string | null;
    repeatIntervalMinutes: number | null; maxRepeats: number; isActive: boolean;
  }): Promise<AlertEscalationPolicyRow> {
        return this.policies.createEscalationPolicy(input);
    }

    async listEscalationPolicies(organizationId: string, limit: number, offset: number): Promise<{ data: AlertEscalationPolicyRow[]; total: number }> {
        return this.policies.listEscalationPolicies(organizationId, limit, offset);
    }

    async findEscalationPolicy(organizationId: string, id: string): Promise<AlertEscalationPolicyRow | null> {
        return this.policies.findEscalationPolicy(organizationId, id);
    }

    async deleteEscalationPolicy(organizationId: string, id: string): Promise<void> {
        return this.policies.deleteEscalationPolicy(organizationId, id);
    }

    async upsertEscalationStep(policyId: string, input: {
    stepNumber: number; waitMinutes: number; connectorIds: string[]; routeIds: string[];
    notifyOnCall: boolean; customMessageTemplate: string | null; templateId: string | null; isActive: boolean;
  }): Promise<AlertEscalationStepRow> {
        return this.policies.upsertEscalationStep(policyId, input);
    }

    async listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]> {
        return this.policies.listEscalationSteps(policyId);
    }

    async listEscalationStepsByPolicyIds(policyIds: string[]): Promise<AlertEscalationStepRow[]> {
        return this.policies.listEscalationStepsByPolicyIds(policyIds);
    }

    async createTemplate(input: {
    organizationId: string; name: string; templateType: string; content: string;
    variablesSchema: unknown[]; defaultForSeverity: string | null; connectorType: string | null;
    isDefault: boolean; sampleData: Record<string, unknown>;
  }): Promise<AlertTemplateRow> {
        return this.templates.createTemplate(input);
    }

    async findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null> {
        return this.templates.findTemplate(organizationId, id);
    }

    async listTemplates(organizationId: string, limit: number, offset: number): Promise<{ data: AlertTemplateRow[]; total: number }> {
        return this.templates.listTemplates(organizationId, limit, offset);
    }

    async deleteTemplate(organizationId: string, id: string): Promise<void> {
        return this.templates.deleteTemplate(organizationId, id);
    }

    async createRoutingRule(input: {
    organizationId: string; name: string; description: string | null; priority: number;
    conditions: Record<string, unknown>; targetConnectorIds: string[]; targetRouteIds: string[];
    fallbackConnectorIds: string[]; templateId: string | null; isActive: boolean;
  }): Promise<AlertRoutingRuleRow> {
        return this.routing.createRoutingRule(input);
    }

    async listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]> {
        return this.routing.listRoutingRules(organizationId);
    }

    async findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null> {
        return this.routing.findRoutingRule(organizationId, id);
    }

    async deleteRoutingRule(organizationId: string, id: string): Promise<void> {
        return this.routing.deleteRoutingRule(organizationId, id);
    }

    async queryMetrics(organizationId: string, filters: {
    metricType?: string; ruleId?: string; granularity: MetricGranularity; from?: Date; to?: Date; limit: number;
  }): Promise<AlertMetricRow[]> {
        return this.metrics.queryMetrics(organizationId, filters);
    }

    async getRealtimeStats(organizationId: string): Promise<{
    firing: number; acknowledged: number; resolvedLast24h: number; mttrSeconds: number | null; mttaSeconds: number | null;
  }> {
        return this.metrics.getRealtimeStats(organizationId);
    }

}
