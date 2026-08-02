/**
 * Observability service — the module's application layer.
 *
 * Every explorer capability funnels through here: list/summary/statistics/
 * timeline (via the Unified Explorer Query Engine), universal event detail
 * (via the Correlation Engine), and AI investigation (via the assembler +
 * investigator). Controllers stay thin; nothing here builds SQL by hand.
 */
import type { ExplorerListResponse, QueryContext, TimelineBucket } from './query-engine/index.js';
import type { FacetDef } from './query-engine/index.js';
import { ObservabilityRepository } from './repository.js';
import { CorrelationEngine, type CorrelationBundle } from './correlation/engine.js';
import { AIInvestigator, type AIInvestigationResult } from './ai/investigator.js';
import { type AIIntent } from './ai/context-assembler.js';
import type { TimelineInterval } from './query-engine/index.js';
export interface EventDetail {
    resource: string;
    entity: Record<string, unknown>;
    attributes: unknown;
    metadata: unknown;
    payload: unknown;
    trace: Record<string, unknown> | null;
    spanTree: unknown;
    spans: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
    relatedErrors: Array<Record<string, unknown>>;
    relatedRequests: Array<Record<string, unknown>>;
    metrics: Array<Record<string, unknown>>;
    profiles: Array<Record<string, unknown>>;
    crons: Array<Record<string, unknown>>;
    correlations: CorrelationBundle['keys'];
    counts: Record<string, number>;
    timeline: TimelineBucket[];
    aiContext: {
        intents: readonly AIIntent[];
        facts: string[];
    };
}
export interface NavNode {
    label: string;
    route: string;
    resource?: string;
    live?: boolean;
    children?: NavNode[];
}
export declare class ObservabilityService {
    private readonly repository;
    private readonly correlation;
    private readonly investigator;
    private readonly engine;
    constructor(repository: ObservabilityRepository, correlation: CorrelationEngine, investigator: AIInvestigator);
    /** Resolve a resource by name, failing closed on unknown names. */
    private resource;
    /** List of explorer resource names (for discovery/health). */
    resourceNames(): string[];
    /** Toolbar facet metadata for a resource (available filters). */
    facets(name: string): FacetDef[];
    list(name: string, ctx: QueryContext, rawQuery: unknown): Promise<ExplorerListResponse<Record<string, unknown>>>;
    summary(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number>>;
    statistics(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number | null>>;
    timeline(name: string, ctx: QueryContext, rawQuery: unknown, interval: TimelineInterval): Promise<TimelineBucket[]>;
    /**
     * Live tail: rows newer than `since` for the current filter set, ascending.
     * Backs the SSE stream — a bounded poll, no Redis pub/sub dependency.
     */
    pollSince(name: string, ctx: QueryContext, rawQuery: unknown, since: Date, max?: number): Promise<Array<Record<string, unknown>>>;
    /** Universal event detail: one correlated payload; the frontend joins nothing. */
    detail(name: string, ctx: QueryContext, id: string): Promise<EventDetail>;
    /** Related events of one type for a detail page's lazy relationship tabs. */
    related(name: string, ctx: QueryContext, id: string, relation: string): Promise<Array<Record<string, unknown>>>;
    /** AI investigation for a single event (Explain / Root Cause / …). */
    askEvent(name: string, ctx: QueryContext, id: string, intent: AIIntent, question?: string): Promise<AIInvestigationResult>;
    /**
     * AI investigation over a filtered result set (Ask AI from the toolbar).
     * The context is built from summary + statistics + a sample, so the model
     * reasons over the aggregate rather than a single row.
     */
    askList(name: string, ctx: QueryContext, rawQuery: unknown, intent: AIIntent, question?: string): Promise<AIInvestigationResult>;
    /**
     * Detail timeline: occurrence trend for the event's natural group key over a
     * bounded window around the event. Errors group by fingerprint, requests by
     * route; other resources return an empty trend (their detail is point-in-time).
     */
    private detailTimeline;
    private groupFilter;
    /** Sidebar / information architecture (Phase 1). */
    getNavigation(): NavNode[];
}
//# sourceMappingURL=service.d.ts.map