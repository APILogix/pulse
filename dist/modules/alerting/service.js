import { AlertingRepository } from './repository.js';
import { RulesService } from './rules/rules.service.js';
import { EventsService } from './events/events.service.js';
import { SilencesService } from './silences/silences.service.js';
import { PoliciesService } from './policies/policies.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { RoutingService } from './routing/routing.service.js';
import { MetricsService } from './metrics/metrics.service.js';
export * from './rules/rules.service.js';
export * from './events/events.service.js';
export * from './silences/silences.service.js';
export * from './policies/policies.service.js';
export * from './templates/templates.service.js';
export * from './routing/routing.service.js';
export * from './metrics/metrics.service.js';
export class AlertingService {
    rules;
    events;
    silences;
    policies;
    templates;
    routing;
    metrics;
    constructor(deps) {
        this.rules = new RulesService(deps);
        this.events = new EventsService(deps);
        this.silences = new SilencesService(deps);
        this.policies = new PoliciesService(deps);
        this.templates = new TemplatesService(deps);
        this.routing = new RoutingService(deps);
        this.metrics = new MetricsService(deps);
    }
    async createRule(orgId, meta, body) {
        return this.rules.createRule(orgId, meta, body);
    }
    async listRules(orgId, query) {
        return this.rules.listRules(orgId, query);
    }
    async getRule(orgId, id) {
        return this.rules.getRule(orgId, id);
    }
    async updateRule(orgId, meta, id, body) {
        return this.rules.updateRule(orgId, meta, id, body);
    }
    async deleteRule(orgId, meta, id) {
        return this.rules.deleteRule(orgId, meta, id);
    }
    async setRuleEnabled(orgId, meta, id, enabled) {
        return this.rules.setRuleEnabled(orgId, meta, id, enabled);
    }
    async cloneRule(orgId, meta, id) {
        return this.rules.cloneRule(orgId, meta, id);
    }
    async testRule(orgId, id, body) {
        return this.rules.testRule(orgId, id, body);
    }
    async ingestEvent(orgId, body) {
        return this.events.ingestEvent(orgId, body);
    }
    async listEvents(orgId, query) {
        return this.events.listEvents(orgId, query);
    }
    async getEvent(orgId, id) {
        return this.events.getEvent(orgId, id);
    }
    async getEventDeliveries(orgId, id) {
        return this.events.getEventDeliveries(orgId, id);
    }
    async acknowledgeEvent(orgId, meta, id, body) {
        return this.events.acknowledgeEvent(orgId, meta, id, body);
    }
    async resolveEvent(orgId, meta, id, body) {
        return this.events.resolveEvent(orgId, meta, id, body);
    }
    async silenceFromEvent(orgId, meta, id, durationMinutes, comment) {
        return this.events.silenceFromEvent(orgId, meta, id, durationMinutes, comment);
    }
    async createSilence(orgId, meta, body) {
        return this.silences.createSilence(orgId, meta, body);
    }
    async listSilences(orgId, active, limit, offset) {
        return this.silences.listSilences(orgId, active, limit, offset);
    }
    async expireSilence(orgId, meta, id) {
        return this.silences.expireSilence(orgId, meta, id);
    }
    async createEscalationPolicy(orgId, meta, body) {
        return this.policies.createEscalationPolicy(orgId, meta, body);
    }
    async listEscalationPolicies(orgId, limit, offset) {
        return this.policies.listEscalationPolicies(orgId, limit, offset);
    }
    async getEscalationPolicy(orgId, id) {
        return this.policies.getEscalationPolicy(orgId, id);
    }
    async deleteEscalationPolicy(orgId, meta, id) {
        return this.policies.deleteEscalationPolicy(orgId, meta, id);
    }
    async upsertEscalationStep(orgId, meta, policyId, body) {
        return this.policies.upsertEscalationStep(orgId, meta, policyId, body);
    }
    async createTemplate(orgId, meta, body) {
        return this.templates.createTemplate(orgId, meta, body);
    }
    async listTemplates(orgId, limit, offset) {
        return this.templates.listTemplates(orgId, limit, offset);
    }
    async deleteTemplate(orgId, meta, id) {
        return this.templates.deleteTemplate(orgId, meta, id);
    }
    async previewTemplate(orgId, id, sampleData) {
        return this.templates.previewTemplate(orgId, id, sampleData);
    }
    async createRoutingRule(orgId, meta, body) {
        return this.routing.createRoutingRule(orgId, meta, body);
    }
    async listRoutingRules(orgId) {
        return this.routing.listRoutingRules(orgId);
    }
    async deleteRoutingRule(orgId, meta, id) {
        return this.routing.deleteRoutingRule(orgId, meta, id);
    }
    async testRouting(orgId, body) {
        return this.routing.testRouting(orgId, body);
    }
    async getMetrics(orgId, query) {
        return this.metrics.getMetrics(orgId, query);
    }
    async getStats(orgId) {
        return this.metrics.getStats(orgId);
    }
}
//# sourceMappingURL=service.js.map