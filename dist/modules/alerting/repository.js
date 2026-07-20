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
export class AlertingRepository {
    rules = new RulesRepository();
    events = new EventsRepository();
    silences = new SilencesRepository();
    policies = new PoliciesRepository();
    templates = new TemplatesRepository();
    routing = new RoutingRepository();
    metrics = new MetricsRepository();
    async withTransaction(fn) {
        return this.rules.withTransaction(fn);
    }
    async createRule(input) {
        return this.rules.createRule(input);
    }
    async findRuleById(organizationId, id) {
        return this.rules.findRuleById(organizationId, id);
    }
    async getRuleConditions(ruleId) {
        return this.rules.getRuleConditions(ruleId);
    }
    async getRuleActions(ruleId) {
        return this.rules.getRuleActions(ruleId);
    }
    async getRuleActionsByRuleIds(ruleIds) {
        return this.rules.getRuleActionsByRuleIds(ruleIds);
    }
    async listRules(organizationId, query) {
        return this.rules.listRules(organizationId, query);
    }
    async updateRule(organizationId, id, fields, conditions, actions, updatedBy) {
        return this.rules.updateRule(organizationId, id, fields, conditions, actions, updatedBy);
    }
    async softDeleteRule(organizationId, id) {
        return this.rules.softDeleteRule(organizationId, id);
    }
    async setRuleEnabled(organizationId, id, enabled) {
        return this.rules.setRuleEnabled(organizationId, id, enabled);
    }
    async findActiveEventByFingerprint(organizationId, fingerprint, windowSeconds, projectId) {
        return this.events.findActiveEventByFingerprint(organizationId, fingerprint, windowSeconds, projectId);
    }
    async incrementDuplicate(eventId) {
        return this.events.incrementDuplicate(eventId);
    }
    async insertEvent(input) {
        return this.events.insertEvent(input);
    }
    async findEventById(organizationId, id) {
        return this.events.findEventById(organizationId, id);
    }
    async listEvents(organizationId, query) {
        return this.events.listEvents(organizationId, query);
    }
    async acknowledgeEvent(organizationId, eventId, userId, expiresAt, comment) {
        return this.events.acknowledgeEvent(organizationId, eventId, userId, expiresAt, comment);
    }
    async resolveEvent(organizationId, eventId, userId, reason, autoResolved) {
        return this.events.resolveEvent(organizationId, eventId, userId, reason, autoResolved);
    }
    async insertHistory(input, client) {
        return this.events.insertHistory(input, client);
    }
    async getEventHistory(eventId) {
        return this.events.getEventHistory(eventId);
    }
    async getEventDeliveries(eventId) {
        return this.events.getEventDeliveries(eventId);
    }
    async createBatchFromPending(organizationId, limit, workerId) {
        return this.events.createBatchFromPending(organizationId, limit, workerId);
    }
    async getBatchWithEvents(batchId, organizationId) {
        return this.events.getBatchWithEvents(batchId, organizationId);
    }
    async completeBatch(batchId, counts, durationMs, status, errorMessage) {
        return this.events.completeBatch(batchId, counts, durationMs, status, errorMessage);
    }
    async bulkUpdateEventStatus(organizationId, updates) {
        return this.events.bulkUpdateEventStatus(organizationId, updates);
    }
    async bulkInsertDeliveryAttempts(rows) {
        return this.events.bulkInsertDeliveryAttempts(rows);
    }
    async findOrgsWithPendingEvents(limit) {
        return this.events.findOrgsWithPendingEvents(limit);
    }
    async claimAutoResolvable(limit) {
        return this.events.claimAutoResolvable(limit);
    }
    async claimEscalationDue(limit) {
        return this.events.claimEscalationDue(limit);
    }
    async advanceEscalation(eventId, stepNumber, repeatCount, nextEscalationAt) {
        return this.events.advanceEscalation(eventId, stepNumber, repeatCount, nextEscalationAt);
    }
    async resumeExpiredAcknowledgments(limit) {
        return this.events.resumeExpiredAcknowledgments(limit);
    }
    async requeueStuckProcessingEvents(staleMinutes, limit) {
        return this.events.requeueStuckProcessingEvents(staleMinutes, limit);
    }
    async failStaleBatches(staleMinutes) {
        return this.events.failStaleBatches(staleMinutes);
    }
    async setBatchJobId(batchId, jobId) {
        return this.events.setBatchJobId(batchId, jobId);
    }
    async getThrottleStates(actionIds) {
        return this.events.getThrottleStates(actionIds);
    }
    async recordThrottleNotifications(actionIds) {
        return this.events.recordThrottleNotifications(actionIds);
    }
    async insertDeadLetter(input) {
        return this.events.insertDeadLetter(input);
    }
    async listDeadLetters(organizationId, query) {
        return this.events.listDeadLetters(organizationId, query);
    }
    async findDeadLetterById(organizationId, id) {
        return this.events.findDeadLetterById(organizationId, id);
    }
    async claimRetryableDeadLetters(limit) {
        return this.events.claimRetryableDeadLetters(limit);
    }
    async markDeadLetterRetried(id) {
        return this.events.markDeadLetterRetried(id);
    }
    async markDeadLetterExhausted(id) {
        return this.events.markDeadLetterExhausted(id);
    }
    async discardDeadLetter(organizationId, id, userId) {
        return this.events.discardDeadLetter(organizationId, id, userId);
    }
    async purgeOldTerminalEvents(days) {
        return this.events.purgeOldTerminalEvents(days);
    }
    async purgeOldBatches(days) {
        return this.events.purgeOldBatches(days);
    }
    async purgeOldDeliveryAttempts(days) {
        return this.events.purgeOldDeliveryAttempts(days);
    }
    async purgeOldDeadLetters(days) {
        return this.events.purgeOldDeadLetters(days);
    }
    async purgeOldThrottleWindows() {
        return this.events.purgeOldThrottleWindows();
    }
    async createSilence(input) {
        return this.silences.createSilence(input);
    }
    async listSilences(organizationId, active, limit, offset) {
        return this.silences.listSilences(organizationId, active, limit, offset);
    }
    async expireSilence(organizationId, id) {
        return this.silences.expireSilence(organizationId, id);
    }
    async findActiveSilences(organizationId, ruleId) {
        return this.silences.findActiveSilences(organizationId, ruleId);
    }
    async createEscalationPolicy(input) {
        return this.policies.createEscalationPolicy(input);
    }
    async listEscalationPolicies(organizationId, limit, offset) {
        return this.policies.listEscalationPolicies(organizationId, limit, offset);
    }
    async findEscalationPolicy(organizationId, id) {
        return this.policies.findEscalationPolicy(organizationId, id);
    }
    async deleteEscalationPolicy(organizationId, id) {
        return this.policies.deleteEscalationPolicy(organizationId, id);
    }
    async upsertEscalationStep(policyId, input) {
        return this.policies.upsertEscalationStep(policyId, input);
    }
    async listEscalationSteps(policyId) {
        return this.policies.listEscalationSteps(policyId);
    }
    async listEscalationStepsByPolicyIds(policyIds) {
        return this.policies.listEscalationStepsByPolicyIds(policyIds);
    }
    async createTemplate(input) {
        return this.templates.createTemplate(input);
    }
    async findTemplate(organizationId, id) {
        return this.templates.findTemplate(organizationId, id);
    }
    async listTemplates(organizationId, limit, offset) {
        return this.templates.listTemplates(organizationId, limit, offset);
    }
    async deleteTemplate(organizationId, id) {
        return this.templates.deleteTemplate(organizationId, id);
    }
    async createRoutingRule(input) {
        return this.routing.createRoutingRule(input);
    }
    async listRoutingRules(organizationId) {
        return this.routing.listRoutingRules(organizationId);
    }
    async findRoutingRule(organizationId, id) {
        return this.routing.findRoutingRule(organizationId, id);
    }
    async deleteRoutingRule(organizationId, id) {
        return this.routing.deleteRoutingRule(organizationId, id);
    }
    async queryMetrics(organizationId, filters) {
        return this.metrics.queryMetrics(organizationId, filters);
    }
    async getRealtimeStats(organizationId) {
        return this.metrics.getRealtimeStats(organizationId);
    }
}
//# sourceMappingURL=repository.js.map