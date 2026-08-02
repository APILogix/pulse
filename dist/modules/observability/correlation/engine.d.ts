/**
 * Correlation Engine (Phase 16).
 *
 * From a seed event, the backend assembles ONE correlated bundle spanning
 * requests, errors, logs, traces, spans, metrics, profiles, and crons. The
 * frontend performs zero joins. Correlation keys, in priority order, are
 * `trace_id` (present on every canonical table), then `request_id`. Results are
 * bounded by a time window around the seed and a per-type row cap.
 */
import type { QueryContext } from '../query-engine/index.js';
import type { ObservabilityRepository } from '../repository.js';
export interface CorrelationKeys {
    traceId: string | null;
    requestId: string | null;
    spanId: string | null;
    sessionId: string | null;
    userId: string | null;
}
export interface CorrelationBundle {
    keys: CorrelationKeys;
    trace: Record<string, unknown> | null;
    spanTree: unknown;
    spans: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    relatedErrors: Array<Record<string, unknown>>;
    relatedRequests: Array<Record<string, unknown>>;
    metrics: Array<Record<string, unknown>>;
    profiles: Array<Record<string, unknown>>;
    crons: Array<Record<string, unknown>>;
    counts: Record<string, number>;
}
export declare class CorrelationEngine {
    private readonly repository;
    constructor(repository: ObservabilityRepository);
    extractKeys(seedRow: Record<string, unknown>): CorrelationKeys;
    /**
     * Build the correlated bundle for a seed event. Fetches every related
     * resource in parallel using the strongest available key (trace, then
     * request), excluding the seed row itself.
     */
    correlate(seedResourceName: string, ctx: QueryContext, seedRow: Record<string, unknown>, options?: {
        windowMs?: number;
    }): Promise<CorrelationBundle>;
    private pickCorrelator;
    private fetchTrace;
    private assemble;
}
//# sourceMappingURL=engine.d.ts.map