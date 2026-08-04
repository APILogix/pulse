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

export const HISTOGRAM_EDGES_MS = [
  1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750,
  1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 20_000, 60_000,
] as const;

/** 23 finite edges + 1 overflow bucket. */
export const HISTOGRAM_BUCKETS = HISTOGRAM_EDGES_MS.length + 1;

export function emptyHistogram(): number[] {
  return new Array<number>(HISTOGRAM_BUCKETS).fill(0);
}

/** Index of the bucket a value belongs to. */
export function bucketIndexFor(valueMs: number): number {
  if (!Number.isFinite(valueMs) || valueMs < 0) return 0;
  for (let i = 0; i < HISTOGRAM_EDGES_MS.length; i += 1) {
    if (valueMs < HISTOGRAM_EDGES_MS[i]!) return i;
  }
  return HISTOGRAM_BUCKETS - 1;
}

export function observe(histogram: number[], valueMs: number, count = 1): number[] {
  const index = bucketIndexFor(valueMs);
  histogram[index] = (histogram[index] ?? 0) + count;
  return histogram;
}

export function fromValues(values: readonly number[]): number[] {
  const histogram = emptyHistogram();
  for (const value of values) observe(histogram, value);
  return histogram;
}

/**
 * Element-wise sum. Missing/short arrays are tolerated so a schema change or a
 * partially-written row can never crash compaction.
 */
export function mergeHistograms(histograms: ReadonlyArray<readonly number[] | null | undefined>): number[] {
  const out = emptyHistogram();
  for (const histogram of histograms) {
    if (!histogram) continue;
    const length = Math.min(histogram.length, HISTOGRAM_BUCKETS);
    for (let i = 0; i < length; i += 1) {
      out[i] = (out[i] ?? 0) + Number(histogram[i] ?? 0);
    }
  }
  return out;
}

export function totalCount(histogram: readonly number[] | null | undefined): number {
  if (!histogram) return 0;
  let sum = 0;
  for (const value of histogram) sum += Number(value ?? 0);
  return sum;
}

/**
 * Percentile estimate from a histogram.
 *
 * Uses linear interpolation inside the containing bucket, which keeps the error
 * bounded by that bucket's width. The overflow bucket returns its lower edge
 * because it has no upper bound — a deliberate under-estimate rather than an
 * invented number.
 */
export function percentileFromHistogram(
  histogram: readonly number[] | null | undefined,
  quantile: number,
): number | null {
  const total = totalCount(histogram);
  if (!histogram || total === 0) return null;

  const q = Math.min(Math.max(quantile, 0), 1);
  const target = q * total;

  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    const count = Number(histogram[i] ?? 0);
    if (count === 0) continue;

    if (cumulative + count >= target) {
      const lower = i === 0 ? 0 : HISTOGRAM_EDGES_MS[i - 1]!;
      const upper = i >= HISTOGRAM_EDGES_MS.length ? null : HISTOGRAM_EDGES_MS[i]!;
      if (upper === null) return lower;

      const withinBucket = (target - cumulative) / count;
      return lower + (upper - lower) * Math.min(1, Math.max(0, withinBucket));
    }
    cumulative += count;
  }

  const lastIndex = histogram.length - 1;
  return lastIndex === 0 ? 0 : (HISTOGRAM_EDGES_MS[Math.min(lastIndex - 1, HISTOGRAM_EDGES_MS.length - 1)] ?? 0);
}

export interface HistogramPercentiles {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

export function percentilesFromHistogram(
  histogram: readonly number[] | null | undefined,
): HistogramPercentiles {
  return {
    p50: percentileFromHistogram(histogram, 0.5),
    p75: percentileFromHistogram(histogram, 0.75),
    p90: percentileFromHistogram(histogram, 0.9),
    p95: percentileFromHistogram(histogram, 0.95),
    p99: percentileFromHistogram(histogram, 0.99),
  };
}

export interface HistogramBucketView {
  fromMs: number;
  toMs: number | null;
  count: number;
  pct: number;
}

/** Render-ready bucket list for the distribution chart. */
export function histogramView(histogram: readonly number[] | null | undefined): HistogramBucketView[] {
  const total = totalCount(histogram);
  const out: HistogramBucketView[] = [];
  for (let i = 0; i < HISTOGRAM_BUCKETS; i += 1) {
    const count = Number(histogram?.[i] ?? 0);
    out.push({
      fromMs: i === 0 ? 0 : HISTOGRAM_EDGES_MS[i - 1]!,
      toMs: i >= HISTOGRAM_EDGES_MS.length ? null : HISTOGRAM_EDGES_MS[i]!,
      count,
      pct: total === 0 ? 0 : (count / total) * 100,
    });
  }
  return out;
}

/**
 * SQL fragment that builds the histogram inside the aggregation query, so the
 * worker never ships raw latencies to Node.
 *
 * `column` must be a trusted identifier (never user input).
 */
export function histogramSql(column: string): string {
  const cases = HISTOGRAM_EDGES_MS.map(
    (edge) => `COUNT(*) FILTER (WHERE ${column} < ${edge})`,
  );
  // Convert cumulative "< edge" counts into per-bucket counts in SQL by
  // subtracting the previous cumulative count.
  const buckets: string[] = [];
  for (let i = 0; i < cases.length; i += 1) {
    buckets.push(i === 0 ? cases[0]! : `(${cases[i]!} - ${cases[i - 1]!})`);
  }
  buckets.push(
    `COUNT(*) FILTER (WHERE ${column} >= ${HISTOGRAM_EDGES_MS[HISTOGRAM_EDGES_MS.length - 1]})`,
  );
  return `ARRAY[${buckets.join(',')}]::BIGINT[]`;
}

/** Normalises a Postgres BIGINT[] (returned as strings) into numbers. */
export function parseHistogram(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => Number(entry ?? 0));
}
