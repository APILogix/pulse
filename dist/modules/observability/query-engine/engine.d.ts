/**
 * Unified Explorer Query Engine — orchestrator.
 *
 * The single entry point for querying observability data. Given a resource, a
 * {@link QueryContext}, and an {@link ExplorerQuery}, it validates + normalizes
 * the query (merging parsed search), runs the list/summary/statistics
 * statements, and assembles the shared response envelope with bidirectional
 * keyset cursors. Services depend on this; they never build SQL.
 */
import type { QueryResultRow } from 'pg';
import type { ExplorerListResponse, ExplorerQuery, QueryContext, TimelineBucket } from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { type TimelineInterval } from './sql-builder.js';
/** Minimal execution surface. Backed by the log DB read pool in production. */
export interface QueryExecutor {
    run<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]>;
}
export declare class ExplorerQueryEngine {
    private readonly executor;
    constructor(executor: QueryExecutor);
    /**
     * Merge structured filters with parsed search, then validate every clause
     * against the registry (field exists, operator allowed for its type).
     */
    private normalize;
    /** Execute a list query and assemble the full explorer envelope. */
    list<T>(resource: ExplorerResource<T>, ctx: QueryContext, rawQuery: ExplorerQuery): Promise<ExplorerListResponse<T>>;
    /** Slice the fetched rows and build bidirectional keyset cursors. */
    private paginate;
    /** Bucketed timeline for the current filter set (used by detail/summary). */
    timeline(resource: ExplorerResource, ctx: QueryContext, rawQuery: ExplorerQuery, interval: TimelineInterval): Promise<TimelineBucket[]>;
    /** Summary aggregates only (no rows) — used by the explicit summary endpoint. */
    summary(resource: ExplorerResource, ctx: QueryContext, rawQuery: ExplorerQuery): Promise<Record<string, number>>;
    /** Statistics aggregates only — used by the explicit statistics endpoint. */
    statistics(resource: ExplorerResource, ctx: QueryContext, rawQuery: ExplorerQuery): Promise<Record<string, number | null>>;
    /** Resolve a single row by its stable id within the tenant/time scope. */
    getById<T>(resource: ExplorerResource<T>, ctx: QueryContext, id: string): Promise<T | null>;
}
//# sourceMappingURL=engine.d.ts.map