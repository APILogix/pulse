/**
 * Observability repository — the data-access layer.
 *
 * Implements {@link QueryExecutor} so the engine can run its generated SQL, and
 * exposes safe, allow-listed correlation fetchers used by the correlation
 * engine + detail assembler. All reads go through `logDB.queryWithRetry` on the
 * read path (replica when configured) with retry/backoff.
 */
import type { QueryResultRow } from 'pg';
import { type ExplorerResource, type QueryContext, type QueryExecutor } from './query-engine/index.js';
/** Columns that may be used as a correlation key. Fixed allow-list. */
export declare const CORRELATION_COLUMNS: readonly ["trace_id", "request_id", "span_id", "parent_span_id", "session_id", "user_id"];
export type CorrelationColumn = (typeof CORRELATION_COLUMNS)[number];
export interface CorrelationFetch {
    resource: ExplorerResource;
    ctx: QueryContext;
    column: CorrelationColumn;
    value: string;
    from: Date;
    to: Date;
    limit: number;
    /** Optional row id to exclude (usually the seed event itself). */
    excludeId?: string;
}
export declare class ObservabilityRepository implements QueryExecutor {
    /** Execute engine-generated SQL on the read path. */
    run<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]>;
    /**
     * Fetch rows of a resource correlated by a fixed key column within the
     * tenant + time window. The column is validated against
     * {@link CORRELATION_COLUMNS}; every value is bound as a parameter.
     */
    fetchCorrelated(input: CorrelationFetch): Promise<Array<Record<string, unknown>>>;
    /**
     * Fetch a single row by id or public_id, returning the raw row (all columns) so detail
     * assembly can read correlation keys the projection would omit.
     */
    fetchRawById(resource: ExplorerResource, ctx: QueryContext, id: string): Promise<Record<string, unknown> | null>;
    /**
     * Fetch multiple raw rows by array of IDs or public_ids for bulk AI analysis.
     */
    fetchRawByIds(resource: ExplorerResource, ctx: QueryContext, ids: string[]): Promise<Array<Record<string, unknown>>>;
    /**
     * Fast, bounded count of spans for a request's trace.
     * Prefer trace_id (indexed); fall back to request_id when no trace is attached.
     */
    countRelatedSpans(ctx: QueryContext, traceId: string | null, requestId: string | null, from: Date, to: Date): Promise<number>;
    /**
     * Fast, bounded count of logs correlated to a request by trace_id or request_id.
     * The time window is pinned to the request timestamp so partition pruning stays tight.
     */
    countRelatedLogs(ctx: QueryContext, traceId: string | null, requestId: string | null, from: Date, to: Date): Promise<number>;
    /**
     * Lightweight related errors for a request detail page.
     * Returns only public_id + message; capped at a small limit to keep the response fast.
     */
    fetchRelatedErrors(ctx: QueryContext, traceId: string | null, requestId: string | null, from: Date, to: Date, limit?: number): Promise<Array<{
        publicId: string;
        message: string;
    }>>;
    /**
     * Resolve a trace public_id from a trace_id. Used by request detail to build the
     * clickable trace link without loading the full trace payload.
     */
    fetchTracePublicId(ctx: QueryContext, traceId: string | null): Promise<string | null>;
    /**
     * Resolve a request public_id from a request_id or event_id. Used by error
     * detail to build the clickable request link without loading the full request
     * payload. Matches `request_id` first, then falls back to `event_id` so SDK
     * variants stay compatible.
     */
    fetchRequestPublicId(ctx: QueryContext, requestId: string | null, from: Date, to: Date): Promise<string | null>;
    /**
     * Resolve an error group public_id from an error_group_id UUID or fingerprint.
     */
    fetchErrorGroupPublicId(ctx: QueryContext, errorGroupId: string | null, fingerprint?: string | null): Promise<string | null>;
    /** Build a server-owned project predicate for a scoped repository query. */
    private projectPredicate;
    private errorGroupPublicIdPredicate;
    /**
     * Fetch audit log history for an error group from `error_group_history`.
     */
    getErrorGroupHistory(ctx: QueryContext, groupId: string): Promise<Array<Record<string, unknown>>>;
    private parseJsonValue;
    /**
     * Fetch related error telemetry events from `events_errors` for an error group.
     */
    getRelatedErrorEvents(ctx: QueryContext, groupId: string, fingerprint?: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    /**
     * Fetch latest stack frames and event metadata for an error group sample.
     */
    getErrorGroupStackFrames(ctx: QueryContext, groupId: string, fingerprint?: string): Promise<{
        stackFrames: unknown[];
        route?: string | undefined;
        traceId?: string | undefined;
        statusCode?: number | undefined;
    } | null>;
    /**
     * Calculate occurrence trends (24h hourly, 7d daily, 30d daily) for an error group.
     */
    getErrorGroupTrends(ctx: QueryContext, groupId: string, fingerprint?: string): Promise<{
        trend24h: number[];
        trend7d: number[];
        trend30d: number[];
    }>;
    /**
     * Fetch the latest raw error detail row for an Error Group public ID, ID, or fingerprint.
     */
    fetchLatestErrorForGroup(ctx: QueryContext, groupIdentifier: string): Promise<Record<string, unknown> | null>;
    /**
     * Update error group status and log audit history.
     */
    updateErrorGroupStatus(ctx: QueryContext, groupId: string, status: string, actorId: string, comment?: string): Promise<Record<string, unknown> | null>;
    /**
     * Merge source error group into target error group.
     */
    mergeErrorGroups(ctx: QueryContext, sourceGroupId: string, targetGroupId: string, actorId: string): Promise<Record<string, unknown> | null>;
    /**
     * Batch resolve trace public_ids for an array of trace_ids.
     */
    fetchTracePublicIdMap(ctx: QueryContext, traceIds: string[]): Promise<Map<string, string>>;
    /**
     * Batch resolve latest event public_ids for an array of error group IDs or public IDs.
     */
    fetchLatestEventPublicIdMap(ctx: QueryContext, groupIds: string[]): Promise<Map<string, string>>;
    /**
     * Resolve a project ID (UUID) from a project slug.
     */
    resolveProjectIdFromSlug(ctx: QueryContext, slug: string): Promise<string | null>;
}
//# sourceMappingURL=repository.d.ts.map