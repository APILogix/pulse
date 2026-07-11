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
import { AlertingRepository } from '../repository.js';
import { type CreateRuleBody, type ListRulesQuery, type RequestMeta, type TestRuleBody, type UpdateRuleBody } from '../types.js';
export interface AlertingServiceDeps {
    repository: AlertingRepository;
    logger: FastifyBaseLogger;
}
export declare class RulesService {
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
    private audit;
    private ruleToDto;
    private requireRule;
}
//# sourceMappingURL=rules.service.d.ts.map