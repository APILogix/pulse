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
import { type CreateTemplateBody, type RequestMeta } from '../types.js';
export interface AlertingServiceDeps {
    repository: AlertingRepository;
    logger: FastifyBaseLogger;
}
export declare class TemplatesService {
    private readonly repo;
    private readonly logger;
    constructor(deps: AlertingServiceDeps);
    createTemplate(orgId: string, meta: RequestMeta, body: CreateTemplateBody): Promise<Record<string, unknown>>;
    listTemplates(orgId: string, limit: number, offset: number): Promise<{
        data: Record<string, unknown>[];
        total: number;
    }>;
    deleteTemplate(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    previewTemplate(orgId: string, id: string, sampleData?: Record<string, unknown>): Promise<Record<string, unknown>>;
    private audit;
}
//# sourceMappingURL=templates.service.d.ts.map