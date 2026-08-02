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
import { type WindowSize } from './types.js';
/** Floors a date to the start of its bucket for the given window. */
export declare function floorToWindow(date: Date, window: WindowSize): Date;
/** Start of the bucket after the one containing `date`. */
export declare function ceilToWindow(date: Date, window: WindowSize): Date;
export declare function addWindows(date: Date, window: WindowSize, count: number): Date;
/** Number of whole buckets in [from, to). */
export declare function countBuckets(from: Date, to: Date, window: WindowSize): number;
/**
 * Every bucket start in [from, to), bucket-aligned. Used to zero-fill series so
 * the client never has to reason about gaps.
 */
export declare function enumerateBuckets(from: Date, to: Date, window: WindowSize, max?: number): Date[];
/**
 * Picks the coarsest window that satisfies the requested span while keeping the
 * point count renderable, honouring per-tier retention.
 *
 * Rules (docs/analytics/01-frontend-dashboard-audit.md §3.4):
 *   <= 1h → 1m,  <= 6h → 5m,  <= 7d → 1h,  > 7d → 1d
 */
export declare function selectWindow(from: Date, to: Date, requested?: WindowSize): WindowSize;
/**
 * A window can serve a span only if the whole range is still retained and the
 * resulting series is not absurdly long.
 */
export declare function windowCoversSpan(window: WindowSize, spanSeconds: number, to: Date, now?: Date): boolean;
/** The `date_trunc` expression that aligns a column to a window bucket. */
export declare function bucketExpression(column: string, window: WindowSize): string;
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
export declare function computeRunWindow(params: {
    watermarkAt: Date;
    now: Date;
    maxSpanMinutes: number;
    lateGraceSeconds: number;
    window: WindowSize;
}): RunWindow;
/** Same-length window immediately before `range`, for `compare=previous`. */
export declare function previousRange(from: Date, to: Date): {
    from: Date;
    to: Date;
};
export declare function suggestedRefreshMs(window: WindowSize): number;
export declare function retentionCutoff(window: WindowSize, now?: Date): Date;
/** Windows a table tier participates in, coarsest last. */
export declare function windowsFrom(window: WindowSize): WindowSize[];
/** Percentage change guarded against division by zero. */
export declare function deltaPct(current: number | null, previous: number | null): number | null;
//# sourceMappingURL=windows.d.ts.map