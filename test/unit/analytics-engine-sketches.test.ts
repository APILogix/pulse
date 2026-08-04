import { describe, expect, it } from 'vitest';
import {
  HISTOGRAM_BUCKETS,
  HISTOGRAM_EDGES_MS,
  bucketIndexFor,
  emptyHistogram,
  fromValues,
  histogramSql,
  histogramView,
  mergeHistograms,
  parseHistogram,
  percentileFromHistogram,
  percentilesFromHistogram,
  totalCount,
} from '../../src/modules/analytics-engine/histogram.js';
import {
  addToSketch,
  createSketch,
  estimateCardinality,
  estimateUnion,
  fromBuffer,
  isValidSketch,
  mergeSketches,
  sketchFromValues,
  toBuffer,
  HLL_REGISTERS,
} from '../../src/modules/analytics-engine/hll.js';

describe('analytics engine — latency histogram', () => {
  it('has one bucket per edge plus an overflow bucket', () => {
    expect(HISTOGRAM_BUCKETS).toBe(HISTOGRAM_EDGES_MS.length + 1);
    expect(emptyHistogram()).toHaveLength(HISTOGRAM_BUCKETS);
  });

  it('assigns values to the correct bucket, including the overflow', () => {
    expect(bucketIndexFor(0)).toBe(0);
    expect(bucketIndexFor(0.5)).toBe(0);
    expect(bucketIndexFor(1)).toBe(1);
    expect(bucketIndexFor(999)).toBe(HISTOGRAM_EDGES_MS.indexOf(1_000));
    expect(bucketIndexFor(120_000)).toBe(HISTOGRAM_BUCKETS - 1);
    expect(bucketIndexFor(Number.NaN)).toBe(0);
    expect(bucketIndexFor(-5)).toBe(0);
  });

  it('counts every observation exactly once', () => {
    const values = [1, 4, 9, 40, 90, 400, 900, 4_000, 90_000];
    const histogram = fromValues(values);
    expect(totalCount(histogram)).toBe(values.length);
  });

  it('merges element-wise and is order independent', () => {
    const a = fromValues([5, 5, 5]);
    const b = fromValues([500, 500]);
    const ab = mergeHistograms([a, b]);
    const ba = mergeHistograms([b, a]);
    expect(ab).toEqual(ba);
    expect(totalCount(ab)).toBe(5);
  });

  it('tolerates null, undefined and short histograms during merge', () => {
    const merged = mergeHistograms([fromValues([10]), null, undefined, [1, 2]]);
    expect(totalCount(merged)).toBe(4);
  });

  it('recovers percentiles within one bucket width', () => {
    // 1000 samples uniformly spread from 0 to 999 ms.
    const values = Array.from({ length: 1_000 }, (_, index) => index);
    const histogram = fromValues(values);

    const p50 = percentileFromHistogram(histogram, 0.5)!;
    const p95 = percentileFromHistogram(histogram, 0.95)!;
    const p99 = percentileFromHistogram(histogram, 0.99)!;

    // True values are 500 / 950 / 990. Error must stay inside the containing
    // bucket (500–750 and 750–1000 here).
    expect(p50).toBeGreaterThanOrEqual(500);
    expect(p50).toBeLessThanOrEqual(750);
    expect(p95).toBeGreaterThanOrEqual(750);
    expect(p95).toBeLessThanOrEqual(1_000);
    expect(p99).toBeGreaterThanOrEqual(750);
    expect(p99).toBeLessThanOrEqual(1_000);
    expect(p50).toBeLessThan(p95);
    expect(p95).toBeLessThanOrEqual(p99);
  });

  it('is exact for a single-valued distribution within a bucket', () => {
    const histogram = fromValues([12, 12, 12, 12]);
    const p95 = percentileFromHistogram(histogram, 0.95)!;
    expect(p95).toBeGreaterThanOrEqual(10);
    expect(p95).toBeLessThanOrEqual(20);
  });

  it('returns null percentiles for an empty histogram', () => {
    expect(percentileFromHistogram(emptyHistogram(), 0.95)).toBeNull();
    expect(percentileFromHistogram(null, 0.5)).toBeNull();
    expect(percentilesFromHistogram(undefined)).toEqual({
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
    });
  });

  it('under-estimates rather than inventing a value in the overflow bucket', () => {
    const histogram = fromValues([120_000, 130_000]);
    const p95 = percentileFromHistogram(histogram, 0.95)!;
    expect(p95).toBe(60_000);
  });

  it('produces a render-ready view whose percentages sum to 100', () => {
    const view = histogramView(fromValues([5, 50, 500, 5_000]));
    expect(view).toHaveLength(HISTOGRAM_BUCKETS);
    const sum = view.reduce((total, bucket) => total + bucket.pct, 0);
    expect(sum).toBeCloseTo(100, 5);
    expect(view.at(-1)!.toMs).toBeNull();
  });

  it('generates per-bucket SQL as differences of cumulative filters', () => {
    const sql = histogramSql('e.latency_ms');
    expect(sql.startsWith('ARRAY[')).toBe(true);
    expect(sql.endsWith(']::BIGINT[]')).toBe(true);
    expect(sql).toContain('COUNT(*) FILTER (WHERE e.latency_ms < 1)');
    expect(sql).toContain('COUNT(*) FILTER (WHERE e.latency_ms >= 60000)');
    // One entry per bucket.
    expect(sql.split('COUNT(*) FILTER').length - 1).toBe(HISTOGRAM_EDGES_MS.length * 2);
  });

  it('parses Postgres bigint arrays returned as strings', () => {
    expect(parseHistogram(['1', '2', '3'])).toEqual([1, 2, 3]);
    expect(parseHistogram(null)).toBeNull();
    expect(parseHistogram('nope')).toBeNull();
  });
});

describe('analytics engine — HyperLogLog', () => {
  it('creates a validly framed sketch', () => {
    const sketch = createSketch();
    expect(sketch).toHaveLength(2 + HLL_REGISTERS);
    expect(isValidSketch(sketch)).toBe(true);
  });

  it('rejects malformed sketches', () => {
    expect(isValidSketch(null)).toBe(false);
    expect(isValidSketch(new Uint8Array(10))).toBe(false);
    expect(isValidSketch('not-a-sketch')).toBe(false);
  });

  it('estimates small cardinalities exactly via linear counting', () => {
    const values = ['a', 'b', 'c', 'd', 'e'];
    const sketch = sketchFromValues(values);
    // Linear counting is exact unless two of the five values collide into the
    // same register, which is possible but vanishingly rare with 16384 registers.
    expect(estimateCardinality(sketch)).toBeGreaterThanOrEqual(values.length - 1);
    expect(estimateCardinality(sketch)).toBeLessThanOrEqual(values.length);
  });

  it('ignores empty and repeated values', () => {
    const sketch = sketchFromValues(['a', 'a', 'a', '']);
    expect(estimateCardinality(sketch)).toBe(1);
  });

  it('estimates 100k distinct values within 3 percent', () => {
    const sketch = createSketch();
    for (let index = 0; index < 100_000; index += 1) {
      addToSketch(sketch, `user-${index}`);
    }
    const estimate = estimateCardinality(sketch);
    const error = Math.abs(estimate - 100_000) / 100_000;
    expect(error).toBeLessThan(0.03);
  });

  it('merges commutatively and associatively', () => {
    const a = sketchFromValues(['1', '2', '3']);
    const b = sketchFromValues(['3', '4']);
    const c = sketchFromValues(['5']);

    const left = mergeSketches([mergeSketches([a, b]), c]);
    const right = mergeSketches([a, mergeSketches([b, c])]);
    const swapped = mergeSketches([c, b, a]);

    expect(Array.from(left)).toEqual(Array.from(right));
    expect(Array.from(left)).toEqual(Array.from(swapped));
    expect(estimateCardinality(left)).toBeGreaterThanOrEqual(4);
    expect(estimateCardinality(left)).toBeLessThanOrEqual(5);
  });

  it('unions overlapping sets without double counting', () => {
    const a = sketchFromValues(Array.from({ length: 1_000 }, (_, i) => `u${i}`));
    const b = sketchFromValues(Array.from({ length: 1_000 }, (_, i) => `u${i + 500}`));
    const union = estimateUnion([a, b]);
    const error = Math.abs(union - 1_500) / 1_500;
    expect(error).toBeLessThan(0.05);
  });

  it('survives a Postgres BYTEA round trip', () => {
    const sketch = sketchFromValues(['x', 'y', 'z']);
    const restored = fromBuffer(toBuffer(sketch));
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(sketch));
    expect(estimateCardinality(restored!)).toBe(estimateCardinality(sketch));
  });

  it('returns zero for a missing sketch instead of throwing', () => {
    expect(estimateCardinality(null)).toBe(0);
    expect(estimateCardinality(undefined)).toBe(0);
  });
});
