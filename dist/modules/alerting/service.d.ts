import type { FastifyBaseLogger } from 'fastify';
import { AlertingRepository } from './repository.js';
import type { RequestMeta } from './types.js';
import type { CreateRuleBody, ListRulesQuery, UpdateRuleBody, TestRuleBody, IngestEventBody, ListEventsQuery, AcknowledgeEventBody, ResolveEventBody, CreateSilenceBody, CreateEscalationPolicyBody, UpsertEscalationStepBody, CreateTemplateBody, CreateRoutingRuleBody, TestRoutingBody, MetricsQuery } from "./types.js";
export * from './rules/rules.service.js';
export * from './events/events.service.js';
export * from './silences/silences.service.js';
export * from './policies/policies.service.js';
export * from './templates/templates.service.js';
export * from './routing/routing.service.js';
export * from './metrics/metrics.service.js';
export interface AlertingServiceDeps {
    repository: AlertingRepository;
    logger: FastifyBaseLogger;
}
export declare class AlertingService {
    private readonly rules;
    private readonly events;
    private readonly silences;
    private readonly policies;
    private readonly templates;
    private readonly routing;
    private readonly metrics;
    constructor(deps: AlertingServiceDeps);
    createRule(orgId: string, meta: RequestMeta, body: CreateRuleBody): Promise<Promise<Record<string, unknown>>>;
    listRules(orgId: string, query: ListRulesQuery): Promise<Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>>;
    getRule(orgId: string, id: string): Promise<Promise<Record<string, unknown>>>;
    updateRule(orgId: string, meta: RequestMeta, id: string, body: UpdateRuleBody): Promise<Promise<Record<string, unknown>>>;
    deleteRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>>;
    setRuleEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<Promise<Record<string, unknown>>>;
    cloneRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<Record<string, unknown>>>;
    testRule(orgId: string, id: string, body: TestRuleBody): Promise<Promise<Record<string, unknown>>>;
    ingestEvent(orgId: string, body: IngestEventBody): Promise<Promise<Record<string, unknown>>>;
    listEvents(orgId: string, query: ListEventsQuery): Promise<Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>>;
    getEvent(orgId: string, id: string): Promise<Promise<Record<string, unknown>>>;
    getEventDeliveries(orgId: string, id: string): Promise<Promise<Record<string, unknown>[]>>;
    acknowledgeEvent(orgId: string, meta: RequestMeta, id: string, body: AcknowledgeEventBody): Promise<Promise<Record<string, unknown>>>;
    resolveEvent(orgId: string, meta: RequestMeta, id: string, body: ResolveEventBody): Promise<Promise<Record<string, unknown>>>;
    silenceFromEvent(orgId: string, meta: RequestMeta, id: string, durationMinutes: number, comment: string | null): Promise<Promise<Record<string, unknown>>>;
    createSilence(orgId: string, meta: RequestMeta, body: CreateSilenceBody): Promise<Promise<Record<string, unknown>>>;
    listSilences(orgId: string, active: boolean | undefined, limit: number, offset: number): Promise<Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>>;
    expireSilence(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>>;
    createEscalationPolicy(orgId: string, meta: RequestMeta, body: CreateEscalationPolicyBody): Promise<Promise<Record<string, unknown>>>;
    listEscalationPolicies(orgId: string, limit: number, offset: number): Promise<Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>>;
    getEscalationPolicy(orgId: string, id: string): Promise<Promise<Record<string, unknown>>>;
    deleteEscalationPolicy(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>>;
    upsertEscalationStep(orgId: string, meta: RequestMeta, policyId: string, body: UpsertEscalationStepBody): Promise<Promise<Record<string, unknown>>>;
    createTemplate(orgId: string, meta: RequestMeta, body: CreateTemplateBody): Promise<Promise<Record<string, unknown>>>;
    listTemplates(orgId: string, limit: number, offset: number): Promise<Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>>;
    deleteTemplate(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>>;
    previewTemplate(orgId: string, id: string, sampleData?: Record<string, unknown>): Promise<Promise<Record<string, unknown>>>;
    createRoutingRule(orgId: string, meta: RequestMeta, body: CreateRoutingRuleBody): Promise<Promise<Record<string, unknown>>>;
    listRoutingRules(orgId: string): Promise<Promise<Record<string, unknown>[]>>;
    deleteRoutingRule(orgId: string, meta: RequestMeta, id: string): Promise<Promise<void>>;
    testRouting(orgId: string, body: TestRoutingBody): Promise<Promise<Record<string, unknown>>>;
    getMetrics(orgId: string, query: MetricsQuery): Promise<Promise<Record<string, unknown>[]>>;
    getStats(orgId: string): Promise<Promise<Record<string, unknown>>>;
}
//# sourceMappingURL=service.d.ts.map