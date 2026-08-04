/**
 * Watermark + run ledger repository.
 *
 * The watermark is the engine's only progress state. It advances in the SAME
 * transaction as the rollup write, so a crash can duplicate work but never skip
 * it (docs/analytics/00-architecture-overview.md §4).
 *
 * Reads and writes here target the Log DB exclusively.
 */
import type { Pool, PoolClient } from 'pg';
import type { AnalyticsWorkerId, WatermarkRow, WindowSize, WorkerHealthSnapshot, WorkerOutcome } from './types.js';
/** How far back a brand-new watermark starts. Bounds first-run cost. */
export declare const WATERMARK_COLD_START_MINUTES = 60;
/** Failure count at which a worker narrows its window (poison-window guard). */
export declare const POISON_WINDOW_FAILURE_THRESHOLD = 5;
/** Failure count at which health reporting flips to unhealthy. */
export declare const UNHEALTHY_FAILURE_THRESHOLD = 3;
export declare class AnalyticsWatermarkRepository {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Startup assertion mirroring `AlertRuntimeRepository.assertRuntimePool`:
     * prove this pool is attached to the database that owns the canonical event
     * tables before any worker starts. Audit finding in
     * docs/analytics/03-logdb-audit.md §6 — a worker pointed at the control plane
     * would silently produce empty rollups forever.
     */
    assertLogDbPool(logger?: {
        info: (obj: object, msg: string) => void;
    }): Promise<void>;
    /**
     * Returns the current watermark, creating a bounded cold-start row when the
     * worker has never run for this organization.
     */
    acquire(workerId: AnalyticsWorkerId, organizationId: string, windowSize: WindowSize, now?: Date): Promise<WatermarkRow>;
    get(workerId: AnalyticsWorkerId, organizationId: string, windowSize: WindowSize): Promise<WatermarkRow | null>;
    /**
     * Advances the watermark inside the caller's transaction. Never moves
     * backwards: `GREATEST` protects against out-of-order job delivery.
     */
    advance(client: PoolClient, params: {
        workerId: AnalyticsWorkerId;
        organizationId: string;
        windowSize: WindowSize;
        watermarkAt: Date;
        lastBucketAt?: Date | undefined;
        rowsProcessed: number;
    }): Promise<void>;
    /**
     * Records a failure without advancing the watermark, so the next run retries
     * the same slice.
     */
    recordFailure(workerId: AnalyticsWorkerId, organizationId: string, windowSize: WindowSize, error: string): Promise<number>;
    /**
     * Effective catch-up span for a worker: halved (repeatedly, floor 1 minute)
     * once a slice has failed repeatedly, so one poison window cannot stall an
     * organization forever.
     */
    static effectiveSpanMinutes(baseMinutes: number, consecutiveFailures: number): number;
    recordRun(params: {
        workerId: AnalyticsWorkerId;
        organizationId: string | null;
        windowSize: WindowSize;
        windowStart: Date | null;
        windowEnd: Date | null;
        rowsRead: number;
        rowsWritten: number;
        durationMs: number;
        outcome: WorkerOutcome;
        errorMessage?: string | undefined;
    }): Promise<void>;
    /** Per-worker health for the process health endpoint. */
    healthSnapshot(now?: Date): Promise<WorkerHealthSnapshot[]>;
    /**
     * Freshness for the API: the oldest watermark across the workers that feed a
     * response. Returns null when nothing has been materialised yet.
     */
    freshnessFor(workerIds: readonly string[], organizationId: string): Promise<Date | null>;
    /** Organizations the engine is already tracking. */
    trackedOrganizations(): Promise<string[]>;
    /** Prunes the run ledger. Retention is fixed at 14 days by design. */
    pruneRuns(retentionDays?: number): Promise<number>;
}
//# sourceMappingURL=watermark.repository.d.ts.map