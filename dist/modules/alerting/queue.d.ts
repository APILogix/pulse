/**
 * Alerting pg-boss queue wiring.
 *
 * Job types (per spec):
 *   - alert.form-batches   — claim pending events into batches of 100, enqueue
 *   - alert.process-batch  — process one batch (teamSize 5 / teamConcurrency 5)
 *   - alert.auto-resolve   — auto-resolve stale firing alerts
 *   - alert.cleanup        — archive/cleanup (scheduled)
 *
 * Registration runs in the WORKER process (see workers/main.ts), where pg-boss
 * is started. The API process stays thin and only inserts pending events; the
 * scheduled `alert.form-batches` job turns them into `alert.process-batch` jobs.
 *
 * Worker config matches the spec: batchSize 100, teamSize 5, teamConcurrency 5,
 * retryLimit 3, retryDelay 60s, retryBackoff true, expireInHours 2.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const ALERT_JOBS: {
    readonly formBatches: "alert.form-batches";
    readonly processBatch: "alert.process-batch";
    readonly autoResolve: "alert.auto-resolve";
    readonly cleanup: "alert.cleanup";
};
export interface AlertingWorkerConfig {
    teamSize?: number;
    teamConcurrency?: number;
    formIntervalSeconds?: number;
    autoResolveIntervalSeconds?: number;
    maxBatchesPerFormRun?: number;
}
/**
 * Register all alerting pg-boss workers + schedules. Idempotent per process.
 * Returns a stop() that cancels schedules.
 */
export declare function registerAlertingWorkers(logger: FastifyBaseLogger, config?: AlertingWorkerConfig): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map