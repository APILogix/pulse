import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { type IngestQueueDepthSnapshot } from '../queue/ingest-queues.js';
export interface RollupRunStats {
    durationMs: number;
    stagingRows: number;
    events: number;
    orgs: number;
    projects: number;
}
export interface DbPoolSnapshot {
    name: string;
    total: number;
    idle: number;
    waiting: number;
}
/**
 * In-process metrics registry. All methods are synchronous and never throw —
 * recording a metric must never break a job.
 */
export declare class WorkerMetrics {
    private readonly queues;
    private readonly processingMs;
    private readonly e2eMs;
    private readonly stageMs;
    private readonly dbQueryMs;
    private readonly dbQueriesPerBatch;
    private readonly eventsPerBatch;
    private readonly bytesPerBatch;
    private readonly orgInFlight;
    private readonly workerInFlight;
    private readonly workerCapacity;
    private readonly fairnessStarvationAdmissions;
    private readonly eventDuplicates;
    private readonly eventFailures;
    private readonly throughput;
    deferredJobs: number;
    fairnessProcessed: number;
    dlqIntake: number;
    rollupRuns: number;
    rollupFailures: number;
    rollupLastRunAt: string | null;
    rollupLastDurationMs: number;
    rollupLastStagingRows: number;
    rollupLastEvents: number;
    rollupLastOrgs: number;
    rollupLastProjects: number;
    private queue;
    private throughputCounter;
    errorGroupsCreated: number;
    errorGroupsReused: number;
    errorRegressions: number;
    errorDuplicates: number;
    /**
     * Times the set-based error grouper bailed out to per-event resolution because
     * a matched group had `merged_into` set. This is the only remaining O(N)
     * database path in error ingestion, so a non-trivial rate here is the signal
     * that error-batch query count has degraded from O(1) to ~3N.
     */
    errorGroupMergeFallbacks: number;
    errorGroupMergeFallbackEvents: number;
    /** Configured concurrent ingest transactions permitted. */
    private writePermits;
    /** Permits currently held (i.e. transactions in flight). */
    private writeInFlight;
    /** Handlers waiting for a permit — the saturation signal. */
    private writeQueued;
    /** High-water mark of `writeQueued`, so short bursts are not missed by scrapes. */
    private writeQueuedPeak;
    private readonly errorGroupLookupMs;
    private readonly errorGroupUpsertMs;
    private readonly errorTransactionMs;
    private readonly errorDomainEventMs;
    private observe;
    recordProcessed(queue: string, type: string, eventsReceived: number, inserted: number, rejected: number, processingMs: number, e2eMsVal: number | null, batchBytes?: number): void;
    recordStage(stage: string, type: string, ms: number): void;
    recordDbQueries(type: string, queries: number): void;
    recordDbQueryDuration(type: string, ms: number): void;
    recordBatchShape(type: string, events: number, bytes: number): void;
    recordFailed(queue: string, eventsReceived: number, type?: string, reason?: string): void;
    recordRetry(queue: string, count?: number): void;
    recordDuplicates(queue: string, type: string, count: number): void;
    recordDeferred(queue: string, events: number): void;
    recordFairnessProcessed(): void;
    recordFairnessStarvationAdmission(queue: string, type: string): void;
    recordDlqIntake(count?: number): void;
    setOrgInFlight(orgId: string, count: number): void;
    setWorkerInFlight(queue: string, type: string, count: number): void;
    setWorkerCapacity(queue: string, type: string, slots: number): void;
    recordErrorGroup(isNew: boolean, isRegression: boolean): void;
    recordErrorDuplicate(): void;
    /** One batch fell back to per-event group resolution; `events` is that batch's size. */
    recordErrorGroupMergeFallback(events: number): void;
    /** Configured write-admission permits (reported once at worker construction). */
    setWritePermits(permits: number): void;
    /**
     * Current admission occupancy. Called on every admit, so the peak is tracked
     * here rather than sampled — a burst that fills and drains between two Prometheus
     * scrapes would otherwise be invisible, which is exactly the event we most need
     * to see when diagnosing a latency spike.
     */
    setWriteAdmission(inFlight: number, queued: number): void;
    recordErrorLatencies(lookup: number | null, upsert: number | null, transaction: number | null, domain: number | null): void;
    recordRollupSuccess(stats: RollupRunStats): void;
    recordRollupFailure(durationMs: number): void;
    /** Render the Prometheus text exposition format (v0.0.4). */
    render(depth: IngestQueueDepthSnapshot | null, dbPools?: readonly DbPoolSnapshot[]): string;
}
/**
 * Tiny HTTP server exposing /metrics and /healthz on
 * env.INGESTION_WORKER_METRICS_PORT. Bind failures are logged as warnings and
 * never crash the worker.
 */
export declare class MetricsServer {
    private readonly metrics;
    private readonly pool;
    private readonly log;
    private readonly dbPools;
    private server;
    private depthCache;
    constructor(metrics: WorkerMetrics, pool: Pool, log: Logger, dbPools?: Array<{
        name: string;
        pool: Pool;
    }>);
    start(): void;
    private handle;
    private depthSnapshot;
    private dbPoolSnapshot;
    stop(): Promise<void>;
}
//# sourceMappingURL=metrics-server.d.ts.map