import { describe, expect, it } from 'vitest';
import {
  addWindows,
  bucketExpression,
  ceilToWindow,
  computeRunWindow,
  countBuckets,
  deltaPct,
  enumerateBuckets,
  floorToWindow,
  previousRange,
  retentionCutoff,
  selectWindow,
  windowCoversSpan,
  windowsFrom,
} from '../../src/modules/analytics-engine/windows.js';
import {
  WINDOW_RETENTION_SECONDS,
  WINDOW_SECONDS,
} from '../../src/modules/analytics-engine/types.js';

const iso = (value: string): Date => new Date(value);

describe('analytics engine — window math', () => {
  it('floors to bucket boundaries for every tier', () => {
    const at = iso('2026-08-01T13:47:32.512Z');
    expect(floorToWindow(at, '1m').toISOString()).toBe('2026-08-01T13:47:00.000Z');
    expect(floorToWindow(at, '5m').toISOString()).toBe('2026-08-01T13:45:00.000Z');
    expect(floorToWindow(at, '1h').toISOString()).toBe('2026-08-01T13:00:00.000Z');
    expect(floorToWindow(at, '1d').toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('is idempotent on an already-aligned instant', () => {
    const aligned = iso('2026-08-01T13:45:00.000Z');
    expect(floorToWindow(aligned, '5m').getTime()).toBe(aligned.getTime());
    expect(ceilToWindow(aligned, '5m').getTime()).toBe(aligned.getTime());
  });

  it('ceils to the next bucket only when unaligned', () => {
    expect(ceilToWindow(iso('2026-08-01T13:45:01.000Z'), '5m').toISOString()).toBe(
      '2026-08-01T13:50:00.000Z',
    );
  });

  it('advances day buckets across a DST-free UTC boundary', () => {
    const start = iso('2026-08-31T00:00:00.000Z');
    expect(addWindows(start, '1d', 1).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('counts and enumerates buckets consistently', () => {
    const from = iso('2026-08-01T00:00:00.000Z');
    const to = iso('2026-08-01T01:00:00.000Z');
    expect(countBuckets(from, to, '1m')).toBe(60);
    expect(countBuckets(from, to, '5m')).toBe(12);
    expect(countBuckets(to, from, '1m')).toBe(0);

    const buckets = enumerateBuckets(from, to, '5m');
    expect(buckets).toHaveLength(12);
    expect(buckets[0]!.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(buckets.at(-1)!.toISOString()).toBe('2026-08-01T00:55:00.000Z');
  });

  it('caps enumeration so a bad range cannot allocate unbounded arrays', () => {
    const from = iso('2020-01-01T00:00:00.000Z');
    const to = iso('2026-01-01T00:00:00.000Z');
    expect(enumerateBuckets(from, to, '1m', 100)).toHaveLength(100);
  });

  it('selects the documented window for each span', () => {
    const now = new Date();
    const spans: Array<[number, string]> = [
      [15 * 60, '1m'],
      [60 * 60, '1m'],
      [6 * 3_600, '5m'],
      [24 * 3_600, '1h'],
      [7 * 86_400, '1h'],
      [30 * 86_400, '1d'],
    ];
    for (const [seconds, expected] of spans) {
      const from = new Date(now.getTime() - seconds * 1_000);
      expect(selectWindow(from, now)).toBe(expected);
    }
  });

  it('rejects a requested window whose retention cannot cover the range', () => {
    const now = new Date();
    // 30 days of history cannot be served from the 1m tier (6h retention).
    const from = new Date(now.getTime() - 30 * 86_400 * 1_000);
    expect(selectWindow(from, now, '1m')).toBe('1d');
    expect(windowCoversSpan('1m', 30 * 86_400, now, now)).toBe(false);
    expect(windowCoversSpan('1d', 30 * 86_400, now, now)).toBe(true);
  });

  it('honours an explicitly requested window when it is serviceable', () => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 60 * 1_000);
    expect(selectWindow(from, now, '5m')).toBe('5m');
  });

  it('builds a 5-minute bucket expression that truncates within the hour', () => {
    expect(bucketExpression('e.timestamp', '1m')).toBe("date_trunc('minute', e.timestamp)");
    expect(bucketExpression('e.timestamp', '1h')).toBe("date_trunc('hour', e.timestamp)");
    expect(bucketExpression('e.timestamp', '5m')).toContain("date_trunc('hour', e.timestamp)");
    expect(bucketExpression('e.timestamp', '5m')).toContain('5 * floor');
  });

  it('derives the previous comparison range with the same span', () => {
    const from = iso('2026-08-01T12:00:00.000Z');
    const to = iso('2026-08-01T13:00:00.000Z');
    const previous = previousRange(from, to);
    expect(previous.from.toISOString()).toBe('2026-08-01T11:00:00.000Z');
    expect(previous.to.toISOString()).toBe(from.toISOString());
    expect(previous.to.getTime() - previous.from.getTime()).toBe(to.getTime() - from.getTime());
  });

  it('exposes retention cutoffs matching the documented tiers', () => {
    const now = iso('2026-08-01T00:00:00.000Z');
    for (const window of ['1m', '5m', '1h', '1d'] as const) {
      const cutoff = retentionCutoff(window, now);
      expect(now.getTime() - cutoff.getTime()).toBe(WINDOW_RETENTION_SECONDS[window] * 1_000);
    }
  });

  it('lists the compaction chain from a starting tier', () => {
    expect(windowsFrom('1m')).toEqual(['1m', '5m', '1h', '1d']);
    expect(windowsFrom('1h')).toEqual(['1h', '1d']);
  });

  it('computes percentage deltas without dividing by zero', () => {
    expect(deltaPct(150, 100)).toBeCloseTo(50);
    expect(deltaPct(50, 100)).toBeCloseTo(-50);
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(null, 10)).toBeNull();
  });
});

describe('analytics engine — run window', () => {
  const base = {
    maxSpanMinutes: 60,
    lateGraceSeconds: 900,
    window: '1m' as const,
  };

  it('marks the run empty when the watermark has caught up', () => {
    const now = iso('2026-08-01T12:00:00.000Z');
    const result = computeRunWindow({ ...base, watermarkAt: now, now });
    expect(result.empty).toBe(true);
  });

  it('never reads past now - 1s so in-flight inserts are not half-counted', () => {
    const now = iso('2026-08-01T12:00:00.000Z');
    const watermarkAt = iso('2026-08-01T11:59:00.000Z');
    const result = computeRunWindow({ ...base, watermarkAt, now });
    expect(result.empty).toBe(false);
    expect(result.end.toISOString()).toBe('2026-08-01T11:59:59.000Z');
  });

  it('caps a cold-start backlog to maxSpanMinutes', () => {
    const now = iso('2026-08-01T12:00:00.000Z');
    const watermarkAt = iso('2026-08-01T00:00:00.000Z');
    const result = computeRunWindow({ ...base, watermarkAt, now, maxSpanMinutes: 30 });
    expect(result.end.getTime() - result.start.getTime()).toBe(30 * 60_000);
  });

  it('extends the recompute floor backwards by the late-event grace', () => {
    const now = iso('2026-08-01T12:00:00.000Z');
    const watermarkAt = iso('2026-08-01T11:59:00.000Z');
    const result = computeRunWindow({ ...base, watermarkAt, now, lateGraceSeconds: 900 });
    // 11:59:00 - 15m = 11:44:00, floored to the minute.
    expect(result.recomputeFrom.toISOString()).toBe('2026-08-01T11:44:00.000Z');
    expect(result.recomputeFrom.getTime()).toBeLessThan(result.start.getTime());
  });

  it('aligns the recompute floor to the bucket for coarse windows', () => {
    const now = iso('2026-08-01T12:00:00.000Z');
    const watermarkAt = iso('2026-08-01T11:59:00.000Z');
    const result = computeRunWindow({
      ...base,
      watermarkAt,
      now,
      window: '1h',
      lateGraceSeconds: 900,
    });
    expect(result.recomputeFrom.toISOString()).toBe('2026-08-01T11:00:00.000Z');
  });

  it('keeps window seconds and tier constants in sync', () => {
    expect(WINDOW_SECONDS['1m']).toBe(60);
    expect(WINDOW_SECONDS['5m']).toBe(300);
    expect(WINDOW_SECONDS['1h']).toBe(3_600);
    expect(WINDOW_SECONDS['1d']).toBe(86_400);
  });
});
