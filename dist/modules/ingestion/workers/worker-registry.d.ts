/**
 * WorkerRegistry — constructs and supervises the ingestion worker tier.
 *
 * Four worker classes, isolated so a slow signal never starves a fast one:
 *
 *   1. GENERAL workers   — drain the fast path (error, message, request, span,
 *      metric, log, cron_checkin). Many workers, high concurrency, small
 *      visibility timeout. Re-validate the payload, route to the
 *      TelemetryWriter, and fire-and-forget a usage increment.
 *
 *   2. SPECIALIZED workers — isolate heavy signals (profile, replay, trace).
 *      Fewer workers, longer visibility timeout, smaller batches. They claim
 *      ONLY their job types so a 30s profile upload never blocks an error from
 *      being persisted. They use a dedicated PgQueue with a longer lease.
 *
 *   3. RETRY worker      — owns queue maintenance (no job claiming): recover
 *      expired leases, prune completed rows, flush usage counters, flush admin
 *      logs. Runs every INGESTION_RETRY_INTERVAL_MS.
 *
 *   4. MAINTENANCE worker — partition automation + retention for the telemetry
 *      tables (TelemetryMaintenanceWorker). Runs every 6h.
 *
 * The general/specialized workers also report rolling performance stats to the
 * TimescaleDB LogDatabase each retry cycle.
 *
 * SKIP LOCKED makes horizontal scaling safe: run multiple worker processes and
 * each job is still handed to exactly one worker.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
export interface WorkerRegistryOptions {
    /** Logical queue name. Default 'ingestion'. */
    queue?: string;
    generalWorkers?: number;
    generalConcurrency?: number;
    generalBatchSize?: number;
    specializedWorkers?: number;
    specializedConcurrency?: number;
    specializedBatchSize?: number;
    visibilityTimeoutMs?: number;
    specializedVisibilityTimeoutMs?: number;
    busyPollMs?: number;
    idlePollMs?: number;
    retryIntervalMs?: number;
    maintenanceIntervalMs?: number;
    completedRetentionMs?: number;
}
export declare class WorkerRegistry {
    private readonly pool;
    private readonly log;
    private readonly queueName;
    private readonly generalQueue;
    private readonly specializedQueue;
    private readonly writer;
    private readonly usage;
    private readonly logDb;
    private readonly adminLogger;
    private readonly maintenance;
    private readonly generalPool;
    private readonly specializedPool;
    private retryTimer;
    private started;
    private readonly opts;
    constructor(pool: Pool, log: Logger, options?: WorkerRegistryOptions);
    /** Construct + start every worker class. */
    start(): Promise<void>;
    /**
     * Retry/maintenance cycle: recover expired leases, prune completed rows,
     * flush usage counters + admin logs, and report per-worker performance to the
     * logging database.
     */
    private retryCycle;
    private workerId;
    /** Drain all workers and close logging resources. */
    stop(): Promise<void>;
}
//# sourceMappingURL=worker-registry.d.ts.map