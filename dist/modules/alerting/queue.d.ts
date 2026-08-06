/**
 * Alerting pg-boss queue wiring (enterprise).
 *
 * Job types:
 *   - alert.form-batches        — claim pending events into batches of 100, enqueue
 *   - alert.process-batch       — process one batch (localConcurrency, dead-lettered)
 *   - alert.escalation-sweep    — advance due escalations + resume expired acks
 *   - alert.auto-resolve        — auto-resolve stale firing alerts
 *   - alert.orphan-sweep        — requeue events/batches stuck in 'processing'
 *   - alert.cleanup             — retention purge (scheduled daily)
 *   - alert.dead-letter-retry   — re-drive retryable dead letters (scheduled)
 *   - alert-dead-letter         — pg-boss dead-letter queue for process-batch
 *
 * Concurrency guarantees:
 *   - pg-boss fetches jobs with FOR UPDATE SKIP LOCKED internally, so two
 *     workers never receive the same job.
 *   - Every DB-side claim (pending events, escalations, expired acks, stuck
 *     processing, dead letters) uses FOR UPDATE SKIP LOCKED too.
 *   - Scheduled jobs use singletonKey so multiple worker processes never
 *     double-run a schedule.
 *
 * Failure model:
 *   - process-batch jobs retry 3× with backoff, then land in
 *     `alert-dead-letter`, which is persisted to `alert_dead_letter_events`.
 *   - The orphan sweeper requeues their events back to 'pending' (automatic
 *     recovery); operators can additionally re-drive or discard dead letters
 *     via the admin API.
 *
 * Registration runs in the WORKER process (see workers/main.ts), where pg-boss
 * is started. The API process stays thin and only inserts pending events.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { ProjectSubscriptionResolver } from './batch-processor.js';
export declare const ALERT_JOBS: {
    readonly formBatches: "alert.form-batches";
    readonly processBatch: "alert.process-batch";
    readonly escalationSweep: "alert.escalation-sweep";
    readonly autoResolve: "alert.auto-resolve";
    readonly orphanSweep: "alert.orphan-sweep";
    readonly cleanup: "alert.cleanup";
    readonly deadLetter: "alert-dead-letter";
    readonly deadLetterRetry: "alert.dead-letter-retry";
    readonly decide: "alert.decide";
    readonly escalate: "alert.escalate";
    readonly correlate: "alert.correlate";
    readonly digest: "notification.digest";
    readonly evaluateFast: "alert.evaluate.fast";
    readonly evaluateWindow: "alert.evaluate.window";
    readonly evaluateOperational: "alert.evaluate.operational";
    readonly evaluateAi: "alert.evaluate.ai";
    readonly notificationRouter: "alert.notification-router";
    readonly telemetryOutboxRelay: "alert.telemetry-outbox-relay";
};
export interface AlertingWorkerConfig {
    teamSize?: number;
    teamConcurrency?: number;
    formIntervalSeconds?: number;
    autoResolveIntervalSeconds?: number;
    maxBatchesPerFormRun?: number;
    /** Events/batches stuck in 'processing' longer than this are requeued/failed. */
    stuckThresholdMinutes?: number;
    /** Max events claimed per escalation/auto-resolve sweep. */
    sweepClaimLimit?: number;
    /** Retention windows for the daily cleanup job. */
    retentionResolvedEventsDays?: number;
    retentionBatchesDays?: number;
    retentionDeliveryAttemptsDays?: number;
    retentionDeadLettersDays?: number;
    /** Max automatic re-drives of a dead letter before it is exhausted. */
    deadLetterMaxRetries?: number;
}
/**
 * Register all alerting pg-boss workers + schedules. Idempotent per process.
 * Returns a stop() that cancels schedules.
 */
/**
 * @param telemetryPool Pool that owns the `events_*` telemetry tables (the Log DB pool).
 *   Injected by the worker bootstrap per ADR-0006 / DEV-002 so this module never imports the
 *   Log DB singleton itself. Omit it and the evaluators fall back to the control-plane pool,
 *   which is correct for single-database deployments.
 */
export declare function registerAlertingWorkers(logger: FastifyBaseLogger, config?: AlertingWorkerConfig, projectSubscriptionResolver?: ProjectSubscriptionResolver, telemetryPool?: Pool): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map