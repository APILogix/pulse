/**
 * Telemetry maintenance worker (partition automation + retention).
 *
 * Runs on a timer (no queue job needed — it is infrastructure housekeeping):
 *   1. Partition automation: pre-create next month's partition for every
 *      partitioned telemetry table so a month boundary never causes an
 *      ingestion INSERT to fail (rows would otherwise fall to the DEFAULT
 *      partition, which is correctness-safe but not performance-safe).
 *   2. Retention: drop whole partitions older than the retention window. Whole-
 *      partition DROP is O(1) and avoids the bloat of row-by-row DELETE.
 *
 * Partition naming convention (set in migration 013/014): <table>_yYYYY_mMM.
 * We only manage tables that follow that convention.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
export declare class TelemetryMaintenanceWorker {
    private readonly pool;
    private readonly log;
    private readonly opts;
    private timer;
    constructor(pool: Pool, log: Logger, opts?: {
        intervalMs?: number;
        retentionMonths?: number;
    });
    start(): void;
    stop(): void;
    runOnce(): Promise<void>;
    /** Pre-create the current and next month partitions for every table. */
    private ensureFuturePartitions;
    /** Drop partitions whose entire range is older than the retention window. */
    private dropExpiredPartitions;
    private addMonth;
}
//# sourceMappingURL=telemetry-maintenance.processor.d.ts.map