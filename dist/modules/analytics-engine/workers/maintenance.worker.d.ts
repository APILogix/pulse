/**
 * Platform maintenance jobs: partitions and retention.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.25 / §3.26
 *
 * Retention operates on an ALLOWLIST only. The SQL helper
 * analytics_engine_drop_partitions_before() raises if asked to touch anything
 * outside the analytics-engine table set, so a bug here cannot delete telemetry.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { type WindowSize } from '../types.js';
/** Every analytics-owned partitioned table with the retention tier it follows. */
export declare function retentionTargets(): Array<{
    table: string;
    window: WindowSize;
}>;
export declare function ensurePartitions(pool: Pool, logger: Logger, daysAhead?: number): Promise<number>;
export interface RetentionOutcome {
    table: string;
    window: WindowSize;
    partitionsDropped: number;
    rowsDeleted: number;
}
/**
 * Prunes analytics-owned rollups.
 *
 * Whole partitions are dropped where possible; the DEFAULT partition (which
 * holds any row outside the declared ranges) is pruned with a bounded DELETE.
 */
export declare function runRetention(pool: Pool, logger: Logger, now?: Date): Promise<RetentionOutcome[]>;
//# sourceMappingURL=maintenance.worker.d.ts.map