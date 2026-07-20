import type { Pool } from 'pg';
import type { Logger } from 'pino';
export declare class WorkerRegistry {
    private readonly pool;
    private readonly log;
    private readonly metrics;
    private readonly processor;
    private readonly rollup;
    private readonly metricsServer;
    /** Tenant fairness: per-org in-flight job count for THIS process. */
    private readonly inFlight;
    private readonly registeredQueues;
    private started;
    constructor(pool: Pool, log: Logger);
    /** Provision queues, then register every worker + cron + metrics. */
    start(): Promise<void>;
    /** offWork every queue (waiting for in-flight jobs), then drain the rest. */
    stop(): Promise<void>;
    private handleIngestBatch;
    /**
     * Per-job wrapper: fairness gate → process. Deferred jobs resolve
     * 'completed' (the re-enqueued copy carries the work); admitted jobs release
     * their in-flight slot in `finally`.
     */
    private runOne;
    private handleDlqBatch;
    /**
     * Both dead-letter shapes land here:
     *   - DlqIntakePayload (has `sourceQueue`): validation rejects routed by the
     *     EventProcessor. The intake job is freshly sent, so the original
     *     ingest-job id is unknown (original_job_id = null).
     *   - Raw IngestJobPayload: pg-boss redelivers the original job (same job
     *     id) after retries/expiry are exhausted → original_job_id = job.id.
     */
    private persistDeadLetter;
    private insertDeadLetter;
    /**
     * Per-job isolation: resolve a JobResult[] so pg-boss settles each job
     * individually (failed jobs are retried, completed ones are not). When EVERY
     * job in the batch failed, throw the first error instead — the outcome is
     * identical (whole batch retried) and matches the plain-throw idiom used by
     * the other pg-boss processors.
     */
    private settle;
}
//# sourceMappingURL=worker-registry.d.ts.map