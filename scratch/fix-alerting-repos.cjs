const { Project } = require('ts-morph');
const fs = require('fs');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/alerting/**/*.repository.ts');
project.addSourceFileAtPath('src/modules/alerting/repository.ts');

const domains = ['rules', 'events', 'silences', 'policies', 'templates', 'routing', 'metrics'];

// Remove unused interfaces from each domain
const keepInterfaces = {
    'rules': ['RuleConditionInsert', 'RuleActionInsert', 'CreateRuleInput'],
    'events': ['InsertEventInput', 'DeliveryAttemptInsert'],
    'silences': [],
    'policies': [],
    'templates': [],
    'routing': [],
    'metrics': []
};

for (const domain of domains) {
    const file = project.getSourceFile(`src/modules/alerting/${domain}/${domain}.repository.ts`);
    if (file) {
        // Remove interfaces not belonging to this domain
        file.getInterfaces().forEach(i => {
            if (!keepInterfaces[domain].includes(i.getName())) {
                i.remove();
            }
        });
        
        // Remove variables that don't belong
        file.getVariableStatements().forEach(v => {
            const name = v.getDeclarations()[0].getName();
            if (name === 'RULE_COLS' && domain !== 'rules') v.remove();
        });
    }
}

// Re-generate facade repository.ts
const facadeContent = `import type { PoolClient } from 'pg';
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
import type { ListRulesQuery, ListEventsQuery, AlertEventStatus, MetricGranularity } from './types.js';

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
    
    // Core Delegation
    async createRule(input: CreateRuleInput) { return this.rules.createRule(input); }
    async findRuleById(organizationId: string, id: string) { return this.rules.findRuleById(organizationId, id); }
    async getRuleConditions(ruleId: string) { return this.rules.getRuleConditions(ruleId); }
    async getRuleActions(ruleId: string) { return this.rules.getRuleActions(ruleId); }
    async listRules(organizationId: string, query: ListRulesQuery) { return this.rules.listRules(organizationId, query); }
    async updateRule(organizationId: string, id: string, fields: Record<string, unknown>, newConditions?: RuleConditionInsert[], newActions?: RuleActionInsert[]) { return this.rules.updateRule(organizationId, id, fields, newConditions, newActions); }
    async softDeleteRule(organizationId: string, id: string) { return this.rules.softDeleteRule(organizationId, id); }
    async setRuleEnabled(organizationId: string, id: string, enabled: boolean) { return this.rules.setRuleEnabled(organizationId, id, enabled); }
    
    async findActiveEventByFingerprint(organizationId: string, ruleId: string | null, fingerprint: string) { return this.events.findActiveEventByFingerprint(organizationId, ruleId, fingerprint); }
    async incrementDuplicate(id: string) { return this.events.incrementDuplicate(id); }
    async insertEvent(input: InsertEventInput) { return this.events.insertEvent(input); }
    async findEventById(organizationId: string, id: string) { return this.events.findEventById(organizationId, id); }
    async listEvents(organizationId: string, query: ListEventsQuery) { return this.events.listEvents(organizationId, query); }
    async acknowledgeEvent(organizationId: string, id: string, byUserId: string, comment?: string, expiresInMinutes?: number) { return this.events.acknowledgeEvent(organizationId, id, byUserId, comment, expiresInMinutes); }
    async resolveEvent(organizationId: string, id: string, byUserId: string | null, reason?: string, comment?: string) { return this.events.resolveEvent(organizationId, id, byUserId, reason, comment); }
    async insertHistory(eventId: string, action: string, actorId: string | null, changes?: Record<string, unknown> | null, comment?: string | null) { return this.events.insertHistory(eventId, action, actorId, changes, comment); }
    async getEventHistory(eventId: string) { return this.events.getEventHistory(eventId); }
    async getEventDeliveries(eventId: string) { return this.events.getEventDeliveries(eventId); }
    async createBatchFromPending(limit: number, workerId: string, pgBossJobId?: string) { return this.events.createBatchFromPending(limit, workerId, pgBossJobId); }
    async getBatchWithEvents(batchId: string) { return this.events.getBatchWithEvents(batchId); }
    async completeBatch(batchId: string, error?: Error, skippedCount?: number) { return this.events.completeBatch(batchId, error, skippedCount); }
    async bulkUpdateEventStatus(updates: { id: string; status: AlertEventStatus; error?: string }[]) { return this.events.bulkUpdateEventStatus(updates); }
    async bulkInsertDeliveryAttempts(attempts: DeliveryAttemptInsert[]) { return this.events.bulkInsertDeliveryAttempts(attempts); }
    async findOrgsWithPendingEvents() { return this.events.findOrgsWithPendingEvents(); }
    async claimAutoResolvable(limit: number) { return this.events.claimAutoResolvable(limit); }
    
    async createSilence(input: any) { return this.silences.createSilence(input); }
    async listSilences(organizationId: string, query: any) { return this.silences.listSilences(organizationId, query); }
    async expireSilence(organizationId: string, id: string) { return this.silences.expireSilence(organizationId, id); }
    async findActiveSilences(organizationId: string) { return this.silences.findActiveSilences(organizationId); }
    
    async createEscalationPolicy(input: any) { return this.policies.createEscalationPolicy(input); }
    async listEscalationPolicies(organizationId: string, query: any) { return this.policies.listEscalationPolicies(organizationId, query); }
    async findEscalationPolicy(organizationId: string, id: string) { return this.policies.findEscalationPolicy(organizationId, id); }
    async deleteEscalationPolicy(organizationId: string, id: string) { return this.policies.deleteEscalationPolicy(organizationId, id); }
    async upsertEscalationStep(policyId: string, input: any) { return this.policies.upsertEscalationStep(policyId, input); }
    async listEscalationSteps(policyId: string) { return this.policies.listEscalationSteps(policyId); }
    
    async createTemplate(input: any) { return this.templates.createTemplate(input); }
    async findTemplate(organizationId: string, id: string) { return this.templates.findTemplate(organizationId, id); }
    async listTemplates(organizationId: string, query: any) { return this.templates.listTemplates(organizationId, query); }
    async deleteTemplate(organizationId: string, id: string) { return this.templates.deleteTemplate(organizationId, id); }
    
    async createRoutingRule(input: any) { return this.routing.createRoutingRule(input); }
    async listRoutingRules(organizationId: string, query: any) { return this.routing.listRoutingRules(organizationId, query); }
    async findRoutingRule(organizationId: string, id: string) { return this.routing.findRoutingRule(organizationId, id); }
    async deleteRoutingRule(organizationId: string, id: string) { return this.routing.deleteRoutingRule(organizationId, id); }
    
    async queryMetrics(organizationId: string, ruleId: string | undefined, granularity: MetricGranularity, fromTime: Date, toTime: Date) { return this.metrics.queryMetrics(organizationId, ruleId, granularity, fromTime, toTime); }
    async getRealtimeStats(organizationId: string) { return this.metrics.getRealtimeStats(organizationId); }
}
`;

fs.writeFileSync('src/modules/alerting/repository.ts', facadeContent);

project.saveSync();
console.log('Cleaned up repository splitting');
