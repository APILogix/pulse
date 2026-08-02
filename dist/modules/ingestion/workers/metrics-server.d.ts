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
/**
 * In-process metrics registry. All methods are synchronous and never throw —
 * recording a metric must never break a job.
 */
export declare class WorkerMetrics {
    private readonly queues;
    private readonly processingMs;
    private readonly e2eMs;
    private readonly orgInFlight;
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
    private observe;
    recordProcessed(queue: string, type: string, eventsReceived: number, inserted: number, rejected: number, processingMs: number, e2eMsVal: number | null): void;
    recordFailed(queue: string, eventsReceived: number): void;
    recordDeferred(queue: string, events: number): void;
    recordFairnessProcessed(): void;
    recordDlqIntake(count?: number): void;
    setOrgInFlight(orgId: string, count: number): void;
    recordRollupSuccess(stats: RollupRunStats): void;
    recordRollupFailure(durationMs: number): void;
    /** Render the Prometheus text exposition format (v0.0.4). */
    render(depth: IngestQueueDepthSnapshot | null): string;
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
    private server;
    private depthCache;
    constructor(metrics: WorkerMetrics, pool: Pool, log: Logger);
    start(): void;
    private handle;
    private depthSnapshot;
    stop(): Promise<void>;
}
//# sourceMappingURL=metrics-server.d.ts.map