/**
 * Shared execution harness for every analytics rollup worker.
 *
 * Responsibilities (docs/analytics/00-architecture-overview.md §4):
 *   1. read the watermark and derive the ingest-time slice to consume
 *   2. bound the slice by ANALYTICS_BATCH_MAX_ROWS (bisect until it fits)
 *   3. recompute every *event-time bucket touched by that slice*, in full
 *   4. write rollups and advance the watermark in ONE transaction
 *   5. record the run in analytics_worker_runs
 *
 * Step 3 is the reason the engine is idempotent: a bucket is always rebuilt from
 * raw rows, never incremented, so replaying a slice converges to the same value.
 */
import type { PoolClient } from 'pg';
import type { Logger } from 'pino';
import { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import { type AnalyticsJobData, type AnalyticsWorkerId, type WindowSize, type WorkerContext, type WorkerRunResult } from '../types.js';
/** Interval literal for a window, used to close the recompute range. */
export declare function windowInterval(window: WindowSize): string;
export interface BucketRecomputeOptions {
    /** Canonical source table (trusted identifier). */
    source: string;
    /** Event-time column used for bucketing. */
    timeColumn?: string;
    /** Ingest-time column used for progress. */
    ingestColumn?: string;
    window: WindowSize;
    /** Additional row filter applied to BOTH the touched-bucket scan and the recompute. */
    where?: string;
    /**
     * Entity expression for Shape B rollups. When set, the statement groups by it
     * and projects `entity_key` / `entity_label`.
     */
    entityKeyExpr?: string;
    entityLabelExpr?: string;
    /**
     * Aggregate projections, in the same order as `columns` after the key columns.
     * Each entry is raw SQL evaluated in the GROUP BY context.
     */
    aggregates: readonly string[];
    /** Full column list for the INSERT, keys first. */
    columns: readonly string[];
    /** Emit the environment='__all__' and project-sentinel roll-up rows. */
    includeSentinelRows?: boolean;
    /** Extra bound parameters appended after $4. */
    extraParams?: readonly unknown[];
}
/**
 * Builds the whole-bucket recompute statement.
 *
 * Parameter contract: $1 = orgId, $2 = ingestStart, $3 = ingestEnd,
 * $4 = recomputeFrom (event-time floor), $5.. = caller extras.
 *
 * Rows with a NULL project_id are excluded: rollup primary keys are total, and
 * ingestion always attributes events to a project. Documented in
 * docs/analytics/07-rollup-tables.md §1.
 */
export declare function buildBucketRecomputeSql(options: BucketRecomputeOptions): string;
export interface RollupStatement {
    table: string;
    sql: string;
    params: readonly unknown[];
}
export interface RunRollupWorkerParams {
    workerId: AnalyticsWorkerId;
    window: WindowSize;
    /** Table scanned to size the batch and to detect touched buckets. */
    sizingTable: string;
    sizingWhere?: string;
    sizingTimeColumn?: string;
    sizingIngestColumn?: string;
    lateGraceSeconds: number;
    maxSpanMinutes: number;
    /** Builds the statements to execute for the resolved window. */
    statements: (slice: ResolvedSlice) => RollupStatement[] | Promise<RollupStatement[]>;
    /** Optional extra work inside the same transaction (state tables, etc.). */
    afterWrite?: (client: PoolClient, slice: ResolvedSlice) => Promise<void>;
}
export interface ResolvedSlice {
    orgId: string;
    ingestStart: Date;
    ingestEnd: Date;
    recomputeFrom: Date;
    window: WindowSize;
    rowsInSlice: number;
}
/**
 * Executes one worker run end to end. Returns a result the caller records; it
 * never throws for expected conditions (empty slice, nothing touched).
 */
export declare function runRollupWorker(ctx: WorkerContext, job: AnalyticsJobData, watermarks: AnalyticsWatermarkRepository, params: RunRollupWorkerParams): Promise<WorkerRunResult>;
/** Shared aggregate fragments used by several workers. */
export declare const AGG: {
    /** Exact distinct count for a column (correct for the bucket it is stored in). */
    readonly distinct: (column: string) => string;
    readonly count: () => string;
    readonly filterCount: (predicate: string) => string;
    readonly sum: (column: string) => string;
    readonly max: (column: string) => string;
    readonly avg: (column: string) => string;
    readonly percentile: (column: string, q: number) => string;
};
/** Logger child helper so every worker logs with the same shape. */
export declare function workerLogger(logger: Logger, workerId: AnalyticsWorkerId): Logger;
export interface SimpleRollupWorkerDefinition {
    id: AnalyticsWorkerId;
    tier: import('../types.js').WorkerTier;
    window: WindowSize;
    source: string;
    table: string;
    shape: import('../types.js').RollupShape;
    columns: readonly string[];
    /** Aggregates in the same order as `columns` after the key columns. */
    aggregates: (config: WorkerContext['config']) => string[];
    entityKeyExpr?: string;
    entityLabelExpr?: string;
    /** Row filter applied to both the touched-bucket scan and the recompute. */
    where?: string;
    timeColumn?: string;
    concurrency?: number;
    retryLimit?: number;
    retryBackoffSeconds?: number;
    lateGraceSeconds?: number;
    maxSpanMinutes?: number;
    description: string;
    /** Extra statements appended to the same transaction. */
    extraStatements?: (slice: ResolvedSlice, config: WorkerContext['config']) => RollupStatement[];
    afterWrite?: (client: PoolClient, slice: ResolvedSlice, ctx: WorkerContext) => Promise<void>;
}
/**
 * Builds a worker spec from a declaration. Every P0/P1 domain worker uses this,
 * which is what keeps 20+ workers consistent: same batching, same idempotency,
 * same watermark handling, same transaction boundary.
 */
export declare function defineSimpleRollupWorker(definition: SimpleRollupWorkerDefinition, watermarks: AnalyticsWatermarkRepository): import('../types.js').AnalyticsWorkerSpec;
//# sourceMappingURL=base.d.ts.map