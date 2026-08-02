/**
 * SQL builder. Deterministic, fully parameterized, index-aware SQL generation
 * for the shared explorer contract. Every statement:
 *   - leads with `organization_id = $1` (+ project/environment) then the time
 *     range, matching `idx_<table>_tenant_env_time` / `_tenant_time`;
 *   - binds every value through {@link ParamBag} (no string interpolation of
 *     values); identifiers come only from the server-defined registry;
 *   - uses keyset (tuple) comparison for pagination — never OFFSET.
 */
import type { ExplorerQuery, QueryContext } from './types.js';
import type { ExplorerResource } from './field-registry.js';
import { ParamBag } from './operators.js';
export interface BuiltStatement {
    sql: string;
    params: unknown[];
}
export interface BuiltListStatement extends BuiltStatement {
    /** True when rows were fetched in reversed order (backward paging). */
    reversed: boolean;
    /** Row limit requested (the SQL fetches limit + 1 to detect more pages). */
    limit: number;
}
/**
 * Shared WHERE predicates: tenant isolation, project/environment scoping, the
 * (clamped) time window, structured filters, and free-text terms. Excludes the
 * cursor predicate so summary/statistics/timeline can reuse it verbatim.
 */
export declare function buildScopePredicates(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, bag: ParamBag, freeText: string[]): string[];
/**
 * Build the paginated list statement. Keyset pagination on `(timeColumn,
 * idColumn)`. Fetches `limit + 1` rows so the engine can report `hasNext`.
 */
export declare function buildListStatement(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, freeText: string[]): BuiltListStatement;
/** Build the summary aggregate statement from the resource's `summary` map. */
export declare function buildSummaryStatement(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, freeText: string[]): BuiltStatement | null;
/** Build the statistics aggregate statement from the resource's `statistics`. */
export declare function buildStatisticsStatement(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, freeText: string[]): BuiltStatement | null;
export type TimelineInterval = 'minute' | 'hour' | 'day';
/** Build a bucketed timeline (count + error count) over the filtered window. */
export declare function buildTimelineStatement(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, freeText: string[], interval: TimelineInterval): BuiltStatement;
//# sourceMappingURL=sql-builder.d.ts.map