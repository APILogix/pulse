/**
 * Bucket + window math for the analytics engine.
 *
 * Two independent time axes are used deliberately
 * (docs/analytics/00-architecture-overview.md §4):
 *
 *   ingest time (events_*.ingested_at) — drives worker progress (watermarks),
 *                                        so late-arriving events are never skipped.
 *   event time  (events_*.timestamp)   — drives bucket assignment, so charts are
 *                                        correct regardless of ingest delay.
 */

import {
  WINDOW_REFRESH_MS,
  WINDOW_RETENTION_SECONDS,
  WINDOW_SECONDS,
  WINDOW_SIZES,
  WINDOW_TRUNC,
  type WindowSize,
} from './types.js';

/** Floors a date to the start of its bucket for the given window. */
export function floorToWindow(date: Date, window: WindowSize): Date {
  const ms = date.getTime();
  if (window === '1d') {
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const size = WINDOW_SECONDS[window] * 1_000;
  return new Date(Math.floor(ms / size) * size);
}

/** Start of the bucket after the one containing `date`. */
export function ceilToWindow(date: Date, window: WindowSize): Date {
  const floored = floorToWindow(date, window);
  if (floored.getTime() === date.getTime()) return floored;
  return addWindows(floored, window, 1);
}

export function addWindows(date: Date, window: WindowSize, count: number): Date {
  if (window === '1d') {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + count);
    return d;
  }
  return new Date(date.getTime() + count * WINDOW_SECONDS[window] * 1_000);
}

/** Number of whole buckets in [from, to). */
export function countBuckets(from: Date, to: Date, window: WindowSize): number {
  if (to <= from) return 0;
  if (window === '1d') {
    return Math.ceil((to.getTime() - from.getTime()) / (WINDOW_SECONDS['1d'] * 1_000));
  }
  return Math.ceil((to.getTime() - from.getTime()) / (WINDOW_SECONDS[window] * 1_000));
}

/**
 * Every bucket start in [from, to), bucket-aligned. Used to zero-fill series so
 * the client never has to reason about gaps.
 */
export function enumerateBuckets(from: Date, to: Date, window: WindowSize, max = 5_000): Date[] {
  const out: Date[] = [];
  let cursor = floorToWindow(from, window);
  while (cursor < to && out.length < max) {
    out.push(cursor);
    cursor = addWindows(cursor, window, 1);
  }
  return out;
}

/**
 * Picks the coarsest window that satisfies the requested span while keeping the
 * point count renderable, honouring per-tier retention.
 *
 * Rules (docs/analytics/01-frontend-dashboard-audit.md §3.4):
 *   <= 1h → 1m,  <= 6h → 5m,  <= 7d → 1h,  > 7d → 1d
 */
export function selectWindow(from: Date, to: Date, requested?: WindowSize): WindowSize {
  const spanSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1_000);

  if (requested && windowCoversSpan(requested, spanSeconds, to)) {
    return requested;
  }

  if (spanSeconds <= 3_600) return '1m';
  if (spanSeconds <= 6 * 3_600) return '5m';
  if (spanSeconds <= 7 * 86_400) return '1h';
  return '1d';
}

/**
 * A window can serve a span only if the whole range is still retained and the
 * resulting series is not absurdly long.
 */
export function windowCoversSpan(window: WindowSize, spanSeconds: number, to: Date, now = new Date()): boolean {
  const ageSeconds = Math.max(0, (now.getTime() - to.getTime()) / 1_000);
  const retention = WINDOW_RETENTION_SECONDS[window];
  if (ageSeconds + spanSeconds > retention) return false;
  return spanSeconds / WINDOW_SECONDS[window] <= 5_000;
}

/** The `date_trunc` expression that aligns a column to a window bucket. */
export function bucketExpression(column: string, window: WindowSize): string {
  const { unit, multiple } = WINDOW_TRUNC[window];
  if (multiple === 1) {
    return `date_trunc('${unit}', ${column})`;
  }
  // 5-minute buckets: truncate to the hour, then floor the minute offset.
  return (
    `date_trunc('hour', ${column}) + ` +
    `make_interval(mins => (${multiple} * floor(date_part('minute', ${column}) / ${multiple})::int))`
  );
}

export interface RunWindow {
  /** Inclusive lower bound on ingested_at. */
  start: Date;
  /** Exclusive upper bound on ingested_at. */
  end: Date;
  /**
   * Buckets at or after this event time are recomputed from scratch. Equals
   * `start - lateGrace` floored to the window so late events fold in correctly.
   */
  recomputeFrom: Date;
  /** True when the watermark had already caught up and there is nothing to do. */
  empty: boolean;
}

/**
 * Computes the ingest-time slice a worker run should consume.
 *
 * - Never reads past `now - 1s` so in-flight inserts are not half-counted.
 * - Never spans more than `maxSpanMinutes`, so a cold start catches up in slices.
 * - Extends the recompute floor backwards by `lateGraceSeconds`.
 */
export function computeRunWindow(params: {
  watermarkAt: Date;
  now: Date;
  maxSpanMinutes: number;
  lateGraceSeconds: number;
  window: WindowSize;
}): RunWindow {
  const { watermarkAt, now, maxSpanMinutes, lateGraceSeconds, window } = params;

  const safeEnd = new Date(now.getTime() - 1_000);
  const cappedEnd = new Date(
    Math.min(safeEnd.getTime(), watermarkAt.getTime() + maxSpanMinutes * 60_000),
  );

  if (cappedEnd <= watermarkAt) {
    return {
      start: watermarkAt,
      end: watermarkAt,
      recomputeFrom: floorToWindow(watermarkAt, window),
      empty: true,
    };
  }

  const recomputeFrom = floorToWindow(
    new Date(watermarkAt.getTime() - lateGraceSeconds * 1_000),
    window,
  );

  return { start: watermarkAt, end: cappedEnd, recomputeFrom, empty: false };
}

/** Same-length window immediately before `range`, for `compare=previous`. */
export function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: new Date(from.getTime()) };
}

export function suggestedRefreshMs(window: WindowSize): number {
  return WINDOW_REFRESH_MS[window];
}

export function retentionCutoff(window: WindowSize, now = new Date()): Date {
  return new Date(now.getTime() - WINDOW_RETENTION_SECONDS[window] * 1_000);
}

/** Windows a table tier participates in, coarsest last. */
export function windowsFrom(window: WindowSize): WindowSize[] {
  const index = WINDOW_SIZES.indexOf(window);
  return WINDOW_SIZES.slice(index) as WindowSize[];
}

/** Percentage change guarded against division by zero. */
export function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
