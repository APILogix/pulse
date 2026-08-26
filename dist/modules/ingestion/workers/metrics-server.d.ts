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