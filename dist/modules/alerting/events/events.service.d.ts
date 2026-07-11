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
import { type AcknowledgeEventBody, type IngestEventBody, type ListEventsQuery, type RequestMeta, type ResolveEventBody } from '../types.js';
export interface AlertingServiceDeps {
    repository: AlertingRepository;
    logger: FastifyBaseLogger;
}
export declare class EventsService {
    private readonly repo;
    private readonly logger;
    constructor(deps: AlertingServiceDeps);
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
    private computeAutoResolveAt;
    private requireRule;
    private requireEvent;
    private audit;
    private eventToDto;
    private silenceToDto;
}
//# sourceMappingURL=events.service.d.ts.map