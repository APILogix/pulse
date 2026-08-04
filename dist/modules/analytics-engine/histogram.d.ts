/**
 * Log-scale latency histogram — the mergeable representation that lets coarse
 * windows keep percentile fidelity without storing raw latencies.
 *
 * Design: docs/analytics/07-rollup-tables.md §1 "Latency representation".
 *
 * 24 buckets. Bucket i holds values v where EDGES[i-1] <= v < EDGES[i]
 * (bucket 0 holds v < EDGES[0]); the final bucket is unbounded.
 * Percentiles are exact inside a 1m bucket (workers also store percentile_cont
 * results there) and bounded by bucket width for merged windows.
 */
export declare const HISTOGRAM_EDGES_MS: readonly [1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 60000];
/** 23 finite edges + 1 overflow bucket. */
export declare const HISTOGRAM_BUCKETS: number;
export declare function emptyHistogram(): number[];
/** Index of the bucket a value belongs to. */
export declare function bucketIndexFor(valueMs: number): number;
export declare function observe(histogram: number[], valueMs: number, count?: number): number[];
export declare function fromValues(values: readonly number[]): number[];
/**
 * Element-wise sum. Missing/short arrays are tolerated so a schema change or a
 * partially-written row can never crash compaction.
 */
export declare function mergeHistograms(histograms: ReadonlyArray<readonly number[] | null | undefined>): number[];
export declare function totalCount(histogram: readonly number[] | null | undefined): number;
/**
 * Percentile estimate from a histogram.
 *
 * Uses linear interpolation inside the containing bucket, which keeps the error
 * bounded by that bucket's width. The overflow bucket returns its lower edge
 * because it has no upper bound — a deliberate under-estimate rather than an
 * invented number.
 */
export declare function percentileFromHistogram(histogram: readonly number[] | null | undefined, quantile: number): number | null;
export interface HistogramPercentiles {
    p50: number | null;
    p75: number | null;
    p90: number | null;
    p95: number | null;
    p99: number | null;
}
export declare function percentilesFromHistogram(histogram: readonly number[] | null | undefined): HistogramPercentiles;
export interface HistogramBucketView {
    fromMs: number;
    toMs: number | null;
    count: number;
    pct: number;
}
/** Render-ready bucket list for the distribution chart. */
export declare function histogramView(histogram: readonly number[] | null | undefined): HistogramBucketView[];
/**
 * SQL fragment that builds the histogram inside the aggregation query, so the
 * worker never ships raw latencies to Node.
 *
 * `column` must be a trusted identifier (never user input).
 */
export declare function histogramSql(column: string): string;
/** Normalises a Postgres BIGINT[] (returned as strings) into numbers. */
export declare function parseHistogram(value: unknown): number[] | null;
//# sourceMappingURL=histogram.d.ts.map