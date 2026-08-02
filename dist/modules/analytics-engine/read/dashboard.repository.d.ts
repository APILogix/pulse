/**
 * Dashboard read repository — rollup-only.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md
 * Invariant: this file must never contain `FROM events_`. Dashboard reads come
 * exclusively from the `*_metrics_*` rollups and the analytics state tables
 * (docs/analytics/00-architecture-overview.md §2). The invariant is asserted by
 * test/unit/analytics-engine-read.test.ts, which reads this file's source.
 *
 * Raw event detail (single-event drill-downs, tailing lists) is served by a
 * separate repository so this boundary stays mechanically checkable.
 */
import type { Pool } from 'pg';
import { percentilesFromHistogram, histogramView } from '../histogram.js';
import type { AnalyticsQueryScope, WindowSize } from '../types.js';
export interface RequestSummaryRow {
    total: number;
    success: number;
    redirect: number;
    clientError: number;
    error: number;
    authFailure: number;
    rateLimited: number;
    slow: number;
    bot: number;
    apdexSatisfied: number;
    apdexTolerating: number;
    bytesIn: number;
    bytesOut: number;
    latencySumMs: number;
    latencyMaxMs: number | null;
    latencyHistogram: number[];
    uniqueUsersExact: number;
    uniqueUsersEstimate: number;
    uniqueSessionsExact: number;
    sampleCount: number;
}
export declare class AnalyticsReadRepository {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Aggregated request summary for a window.
     *
     * Counters are summed across buckets; the latency histogram is merged so the
     * percentiles are recomputed once over the whole range rather than averaging
     * per-bucket percentiles (which would be statistically wrong).
     */
    requestSummary(scope: AnalyticsQueryScope, range?: import("../types.js").AnalyticsRange): Promise<RequestSummaryRow>;
    /** Latency percentiles + distribution derived from the merged histogram. */
    latencyView(summary: RequestSummaryRow): {
        percentiles: ReturnType<typeof percentilesFromHistogram>;
        buckets: ReturnType<typeof histogramView>;
        avgMs: number | null;
    };
    /** Per-bucket series for one or more request counters. */
    requestSeries(scope: AnalyticsQueryScope, metrics: readonly ('total' | 'errors' | 'client_errors' | 'rate_limited' | 'auth_failures' | 'bytes_out')[]): Promise<Map<string, Array<{
        bucket: Date;
        value: number;
    }>>>;
    /** Latency percentile series, recomputed per bucket from stored histograms. */
    latencySeries(scope: AnalyticsQueryScope): Promise<Array<{
        bucket: Date;
        p50: number | null;
        p75: number | null;
        p90: number | null;
        p95: number | null;
        p99: number | null;
    }>>;
    /** Top-N entity rollup rows for any Shape B table. */
    topEntities(scope: AnalyticsQueryScope, params: {
        base: string;
        available: readonly WindowSize[];
        valueColumn: string;
        extraColumns?: readonly string[];
        orderBy?: string;
        direction?: 'asc' | 'desc';
        excludeOther?: boolean;
        range?: {
            from: Date;
            to: Date;
        };
    }): Promise<Array<Record<string, unknown>>>;
    /** Error summary counters for a window. */
    errorSummary(scope: AnalyticsQueryScope, range?: import("../types.js").AnalyticsRange): Promise<{
        total: number;
        fatal: number;
        error: number;
        warning: number;
        uniqueFingerprints: number;
        affectedUsers: number;
    }>;
    /**
     * Error groups: occurrence counts come from the rollups, triage state from
     * analytics_error_groups. This is the read-time join that replaces the
     * non-idempotent counter the worker used to maintain (DEVIATIONS.md D3).
     */
    errorGroups(scope: AnalyticsQueryScope, filters: {
        status?: 'all' | 'resolved' | 'unresolved';
        mechanism?: string;
    }): Promise<Array<Record<string, unknown>>>;
    /** Service fleet rows for the health tiles and the service catalog. */
    services(scope: AnalyticsQueryScope): Promise<Array<Record<string, unknown>>>;
    /** Log level counters. */
    logSummary(scope: AnalyticsQueryScope, range?: import("../types.js").AnalyticsRange): Promise<{
        total: number;
        error: number;
        warn: number;
        info: number;
        debug: number;
    }>;
    /** Trace summary counters. */
    traceSummary(scope: AnalyticsQueryScope, range?: import("../types.js").AnalyticsRange): Promise<{
        traces: number;
        partial: number;
        errorTraces: number;
        spanCountSum: number;
        durationHistogram: number[];
    }>;
    /** Latency heatmap: bucket × latency-band counts for the distribution chart. */
    latencyHeatmap(scope: AnalyticsQueryScope): Promise<Array<{
        bucket: Date;
        histogram: number[];
    }>>;
    /** Project health cards for project lists. */
    projectHealth(organizationId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    /** Bucket expression helper exposed for the raw-detail repository's reuse. */
    static bucketExpressionFor(column: string, window: WindowSize): string;
}
//# sourceMappingURL=dashboard.repository.d.ts.map