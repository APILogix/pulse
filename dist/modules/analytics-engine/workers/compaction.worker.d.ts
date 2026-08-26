/**
 * analytics.compaction — rolls 1m → 5m → 1h → 1d.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.24
 *
 * Merge rules (docs/analytics/07-rollup-tables.md §1):
 *   counters      → SUM
 *   *_max_*       → MAX
 *   *_sum_*       → SUM        (averages are derived at read time)
 *   *_hist        → element-wise SUM, percentiles recomputed from the merge
 *   *_hll         → register-wise MAX (sketch union)
 *   *_exact       → MAX        (honest lower bound when no sketch exists)
 *   last_*        → value from the newest source bucket
 *   text/enum     → value from the newest source bucket
 *
 * The merge is expressed entirely in SQL except for the histogram percentile
 * recomputation and the sketch union, which are applied in a second pass so the
 * mergeable representations stay authoritative.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { type WindowSize } from '../types.js';
/** Tables that participate in the window hierarchy, with their shape. */
export declare const COMPACTION_TARGETS: ReadonlyArray<{
    base: string;
    shape: 'A' | 'B';
    windows: readonly WindowSize[];
}>;
interface ColumnMeta {
    name: string;
    dataType: string;
}
/** Chooses the SQL merge expression for a column based on its name and type. */
export declare function mergeExpressionFor(column: ColumnMeta): string;
export interface CompactionResult {
    table: string;
    window: WindowSize;
    rowsWritten: number;
}
/**
 * Compacts one table tier for a bucket range.
 *
 * `from`/`to` are event-time bounds on the TARGET window; the source rows are
 * selected by the same bounds, so re-running is idempotent.
 */
export declare function compactTier(pool: Pool, params: {
    base: string;
    shape: 'A' | 'B';
    windows: readonly WindowSize[];
    target: Exclude<WindowSize, '1m'>;
    from: Date;
    to: Date;
    logger: Logger;
}): Promise<CompactionResult>;
/**
 * Compacts every table for one target window over a trailing range.
 * Called by the scheduled platform job; not per-organization.
 */
export declare function runCompaction(pool: Pool, logger: Logger, target: Exclude<WindowSize, '1m'>, now?: Date): Promise<CompactionResult[]>;
export {};
//# sourceMappingURL=compaction.worker.d.ts.map