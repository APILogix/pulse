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
    /** Build a server-owned project predicate for a scoped repository query. */
    private projectPredicate;
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
     * Update error group status and log audit history.
     */
    updateErrorGroupStatus(ctx: QueryContext, groupId: string, status: string, actorId: string, comment?: string): Promise<Record<string, unknown> | null>;
    /**
     * Merge source error group into target error group.
     */
    mergeErrorGroups(ctx: QueryContext, sourceGroupId: string, targetGroupId: string, actorId: string): Promise<Record<string, unknown> | null>;
}
//# sourceMappingURL=repository.d.ts.map