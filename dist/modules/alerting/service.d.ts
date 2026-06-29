/**
 * Alerting business service.
 *
 * Owns alert lifecycle rules and orchestration:
 *   - Rule CRUD (with conditions + actions), enable/disable, clone, test.
 *   - Event ingestion: fingerprint → dedup → silence check → persist as pending
 *     (the background batch worker performs routing + delivery).
 *   - Acknowledge / resolve / silence with audit history.
 *   - Template preview, routing test, metrics + realtime stats.
 *
 * Delivery itself is NOT performed here — events are persisted as `pending` and
 * the pg-boss `alert.form-batches` → `alert.process-batch` pipeline delivers
 * them in concurrent batches (see batch-processor.ts / queue.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import { AlertingRepository } from './repository.js';
import { type AcknowledgeEventBody, type CreateEscalationPolicyBody, type CreateRoutingRuleBody, type CreateRuleBody, type CreateSilenceBody, type CreateTemplateBody, type IngestEventBody, type ListEventsQuery, type ListRulesQuery, type MetricsQuery, type RequestMeta, type ResolveEventBody, type TestRoutingBody, type TestRuleBody, type UpdateRuleBody, type UpsertEscalationStepBody } from './types.js';
export interface AlertingServiceDeps {
    repository: AlertingRepository;
    logger: FastifyBaseLogger;
}
export declare class AlertingService {
    private readonly repo;
    private readonly logger;
    constructor(deps: AlertingServiceDeps);
    createRule(orgId: string, meta: RequestMeta, body: CreateRuleBody): Promise<Record<string, unknown>>;
    listRules(orgId: string, query: ListRulesQuery): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    getRule(orgId: string, id: string): Promise<Record<string, unknown>>;
    updateRule(orgId: string, meta: RequestMeta, id: string, body: UpdateRuleBody): Promise<Record<string, unknown>>;
    deleteRule(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    setRuleEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<Record<string, unknown>>;
    cloneRule(orgId: string, meta: RequestMeta, id: string): Promise<Record<string, unknown>>;
    testRule(orgId: string, id: string, body: TestRuleBody): Promise<Record<string, unknown>>;
    ingestEvent(orgId: string, body: IngestEventBody): Promise<Record<string, unknown>>;
    listEvents(orgId: string, query: ListEventsQuery): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    getEvent(orgId: string, id: string): Promise<Record<string, unknown>>;
    getEventDeliveries(orgId: string, id: string): Promise<Record<string, unknown>[]>;
    acknowledgeEvent(orgId: string, meta: RequestMeta, id: string, body: AcknowledgeEventBody): Promise<Record<string, unknown>>;
    resolveEvent(orgId: string, meta: RequestMeta, id: string, body: ResolveEventBody): Promise<Record<string, unknown>>;
    silenceFromEvent(orgId: string, meta: RequestMeta, id: string, durationMinutes: number, comment: string | null): Promise<Record<string, unknown>>;
    createSilence(orgId: string, meta: RequestMeta, body: CreateSilenceBody): Promise<Record<string, unknown>>;
    listSilences(orgId: string, active: boolean | undefined, limit: number, offset: number): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    expireSilence(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    createEscalationPolicy(orgId: string, meta: RequestMeta, body: CreateEscalationPolicyBody): Promise<Record<string, unknown>>;
    listEscalationPolicies(orgId: string, limit: number, offset: number): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    getEscalationPolicy(orgId: string, id: string): Promise<Record<string, unknown>>;
    deleteEscalationPolicy(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    upsertEscalationStep(orgId: string, meta: RequestMeta, policyId: string, body: UpsertEscalationStepBody): Promise<Record<string, unknown>>;
    createTemplate(orgId: string, meta: RequestMeta, body: CreateTemplateBody): Promise<Record<string, unknown>>;
    listTemplates(orgId: string, limit: number, offset: number): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    deleteTemplate(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    previewTemplate(orgId: string, id: string, sampleData?: Record<string, unknown>): Promise<Record<string, unknown>>;
    createRoutingRule(orgId: string, meta: RequestMeta, body: CreateRoutingRuleBody): Promise<Record<string, unknown>>;
    listRoutingRules(orgId: string): Promise<Record<string, unknown>[]>;
    deleteRoutingRule(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    testRouting(orgId: string, body: TestRoutingBody): Promise<Record<string, unknown>>;
    getMetrics(orgId: string, query: MetricsQuery): Promise<Record<string, unknown>[]>;
    getStats(orgId: string): Promise<Record<string, unknown>>;
    private computeAutoResolveAt;
    private requireRule;
    private requireEvent;
    private audit;
    private ruleToDto;
    private eventToDto;
    private silenceToDto;
}
//# sourceMappingURL=service.d.ts.map