/**
 * AnalyticsQueryBuilder — a small, safe, parameterized SQL builder for the
 * read-heavy analytics endpoints.
 *
 * Safety:
 *   - Table names are validated against an allow-list (never interpolated from
 *     user input) to eliminate SQL injection via identifiers.
 *   - All values are bound as parameters ($1, $2, …); nothing is concatenated.
 *   - `organization_id = $1` is always the first predicate (tenant isolation).
 *
 * Performance:
 *   - Every builder starts org-scoped and time-ranged so queries hit the
 *     composite/BRIN indexes from migration 004.
 */
export declare const ANALYTICS_TABLES: {
    readonly errors: "events_errors";
    readonly messages: "events_messages";
    readonly requests: "events_requests";
    readonly spans: "events_spans";
    readonly traces: "events_traces";
    readonly metrics: "events_metrics";
    readonly logs: "events_logs";
    readonly profiles: "events_profiles";
    readonly crons: "events_cron_checkins";
    readonly replays: "events_replays";
};
export type AnalyticsTableKey = keyof typeof ANALYTICS_TABLES;
export type TimeBucket = 'hour' | 'day' | 'week';
export declare class AnalyticsQueryBuilder {
    private readonly table;
    private readonly conditions;
    private readonly params;
    private orderByClause;
    private limitClause;
    constructor(tableKey: AnalyticsTableKey, orgId: string);
    private next;
    whereTimeRange(start: Date, end: Date, column?: string): this;
    whereProject(projectId?: string): this;
    whereEq(column: string, value: unknown): this;
    whereRaw(fragment: string, value: unknown): this;
    whereTrue(column: string, enabled?: boolean): this;
    whereSearch(column: string, query?: string): this;
    whereFullText(column: string, query?: string): this;
    orderBy(column: string, direction?: 'asc' | 'desc'): this;
    paginate(limit: number, offset: number): this;
    private whereClause;
    /** SELECT specific columns. */
    select(columns?: string): {
        sql: string;
        params: unknown[];
    };
    /** COUNT(*) for the current predicates (ignores order/limit). */
    count(): {
        sql: string;
        params: unknown[];
    };
    /**
     * Time-series bucketed counts. `extraSelects` allows additional aggregate
     * expressions (already safe, server-defined — never user input).
     */
    timeSeries(bucket: TimeBucket, extraSelects?: string): {
        sql: string;
        params: unknown[];
    };
}
//# sourceMappingURL=query-builder.d.ts.map