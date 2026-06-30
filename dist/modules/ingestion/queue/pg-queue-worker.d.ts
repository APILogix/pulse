/**
 * PgQueueWorker — polling consumer for the PostgreSQL ingestion queue.
 *
 * Replaces the BullMQ Worker. Mechanics:
 *   - Poll loop claims a batch of jobs with FOR UPDATE SKIP LOCKED (via PgQueue).
 *   - Each job's payload is a normalized, tenant-scoped event (or a batch of
 *     them); the handler persists it through TelemetryWriter.
 *   - Success -> queue.complete(); failure -> queue.fail() (retry w/ backoff or
 *     dead-letter).
 *   - A background timer recovers stuck jobs (crashed workers) and prunes
 *     completed rows.
 *   - Adaptive idle backoff: when the queue is empty the loop sleeps longer to
 *     avoid hammering Postgres; under load it polls tightly.
 *   - Graceful shutdown drains in-flight jobs before exiting.
 *
 * Horizontal scaling: run N of these across processes/nodes. SKIP LOCKED
 * guarantees a job is handed to exactly one worker at a time.
 */
import type { Logger } from 'pino';
import { PgQueue, type ClaimedJob } from './pg-queue.js';
export type JobHandler = (job: ClaimedJob) => Promise<void>;
export interface PgQueueWorkerOptions {
    workerId: string;
    /** Max jobs claimed per poll. */
    batchSize?: number;
    /** Poll interval when the queue had work last cycle. */
    busyPollMs?: number;
    /** Poll interval when the queue was empty (adaptive idle backoff). */
    idlePollMs?: number;
    /** How often to run stuck-job recovery + prune. */
    maintenanceMs?: number;
    /** Retention for completed jobs before pruning. */
    completedRetentionMs?: number;
    /** Max handlers running at once per poll cycle (bounds DB connections). */
    handlerConcurrency?: number;
    /**
     * Restrict this worker to a subset of job types (general vs specialized lane
     * isolation). When omitted the worker claims any pending job.
     */
    jobTypes?: readonly string[];
    /**
     * Whether this worker runs the background stuck-recovery + prune timer.
     * Default true. Set false when a dedicated RETRY worker owns maintenance so
     * the work isn't duplicated across every consumer.
     */
    enableMaintenance?: boolean;
    /** Logical worker type label for performance reporting (e.g. 'general'). */
    workerType?: string;
}
/** Rolling per-worker processing stats, drained for performance reporting. */
export interface WorkerStats {
    workerId: string;
    workerType: string;
    jobsProcessed: number;
    jobsFailed: number;
    pollCycles: number;
    avgDurationMs: number;
    p95DurationMs: number;
}
export declare class PgQueueWorker {
    private readonly queue;
    private readonly handler;
    private readonly log;
    private running;
    private draining;
    private inFlight;
    private pollTimer;
    private maintenanceTimer;
    private readonly workerId;
    private readonly workerType;
    private readonly batchSize;
    private readonly busyPollMs;
    private readonly idlePollMs;
    private readonly maintenanceMs;
    private readonly completedRetentionMs;
    private readonly handlerConcurrency;
    private readonly jobTypes;
    private readonly enableMaintenance;
    private jobsProcessed;
    private jobsFailed;
    private pollCycles;
    private durations;
    constructor(queue: PgQueue, handler: JobHandler, log: Logger, opts: PgQueueWorkerOptions);
    start(): void;
    /** Drain and reset rolling stats (called periodically for perf reporting). */
    drainStats(): WorkerStats;
    private loop;
    /** Run handlers over jobs with a bounded number in flight at once. */
    private runBounded;
    private process;
    private maintenance;
    /** Stop claiming new work and wait for in-flight jobs to settle. */
    stop(timeoutMs?: number): Promise<void>;
}
//# sourceMappingURL=pg-queue-worker.d.ts.map