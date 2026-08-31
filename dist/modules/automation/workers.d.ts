/**
 * Automation Module – pg-boss v12 worker registration.
 *
 * Queues:
 *   - automation-inbox        Process pending inbox events → match → create runs
 *   - automation-run-execute  Execute queued runs sequentially (step-by-step)
 *   - automation-maintenance  Expire approvals, recover stale inbox/runs/steps
 *   - automation-dead-letter  Dead-letter retry for failed inbox events
 *   - automation-schedule     Bounded cron due-scheduling sweep
 *
 * Patterns:
 *   - Safe queue creation (idempotent createQueue)
 *   - Named queues with bounded local concurrency/batch sizes
 *   - Array-normalized job handlers
 *   - pg-boss retry/backoff/expiry/dead-letter options
 *   - Scheduled sweeps with graceful unschedule on stop
 *   - CTE FOR UPDATE SKIP LOCKED in repository claims
 *   - Deterministic per-workflow run idempotency
 *   - Pinned active version actions
 *   - Atomic run+steps creation
 *   - Bounded exponential retries with timeout
 */
import type { FastifyBaseLogger } from 'fastify';
import { AutomationRepository } from './repository.js';
import { AutomationAuditRepository } from './audit.js';
export declare const AUTOMATION_QUEUES: {
    readonly inbox: "automation-inbox";
    readonly execute: "automation-run-execute";
    readonly maintenance: "automation-maintenance";
    readonly deadLetter: "automation-dead-letter";
    readonly schedule: "automation-schedule";
    readonly alertDomainEventIngest: "automation-ingest.alert-domain-event";
};
export interface InboxJobData {
    batchSize?: number;
}
export interface ExecuteJobData {
    runId: string;
    orgId: string;
}
export interface MaintenanceJobData {
    type?: string;
}
export interface ScheduleJobData {
    sweep?: boolean;
}
/**
 * Enqueue an automation job (inbox event or run execution).
 * Exported for use by AutomationService and automation.module.ts wiring.
 * Preserves DB source of truth on send failure (logs but does not throw).
 */
export declare function enqueueAutomationJob(job: {
    type: string;
    payload: Record<string, unknown>;
}): Promise<void>;
/** Outcome of handling a step failure, so the caller knows who owns the retry. */
export interface StepFailureOutcome {
    /** True when the step has attempts left and was put back into 'queued'. */
    retryScheduled: boolean;
    /**
     * True when the application successfully scheduled the delayed execute job.
     * When false and retryScheduled is true, nobody has claimed responsibility for
     * resuming the run, so the caller must let pg-boss retry as a fallback.
     */
    retryEnqueued: boolean;
}
/**
 * Handle step failure with bounded exponential retry.
 *
 * RETRY OWNERSHIP (single authoritative mechanism):
 *   The application owns step retries, not pg-boss. It persists `next_retry_at` on
 *   automation_run_steps and enqueues one delayed execute job to resume the run.
 *   This is the authoritative path because it is the only one that understands
 *   per-step semantics: the action's own retryBackoffSeconds, the durable per-step
 *   `attempt` counter, and the sequential step ordering.
 *
 *   Previously this coexisted with a pg-boss job-level retry (executeRun rethrew the
 *   error), and because the two used different singletonKeys
 *   (`run:<id>:retry:<stepId>` vs `run:<id>`) pg-boss could not dedupe them. That
 *   produced two independent resume attempts per failure, with three concrete
 *   consequences:
 *     1. the earlier pg-boss retry woke up before `next_retry_at`, claimed nothing,
 *        and burned a cycle re-loading the run and re-checking entitlements;
 *     2. once pg-boss exhausted its retryLimit the job was dead-lettered and a
 *        `run.dead_lettered` audit entry was written even though the application
 *        retry was still pending — making a live run look dead;
 *     3. two concurrent claims could consume the per-step attempt budget faster
 *        than max_attempts implies.
 *
 *   pg-boss retry is now the explicit FALLBACK, used only when the application
 *   could not enqueue the delayed job (see the return value). The maintenance sweep
 *   remains the final backstop.
 */
/** Job payload shape published by AlertDomainOutboxRelay (alerting side). */
export interface AlertDomainEventJobData {
    organizationId: string;
    projectId: string | null;
    eventType: string;
    alertKey: string;
    alertEventId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    occurredAt: string;
}
/**
 * Ingest one alert domain event job into automation_events_inbox.
 *
 * Extracted from the pgboss.work() closure (same pattern as handleStepFailure)
 * so the tenant/entitlement/idempotency/audit contract can be unit-tested
 * directly instead of only through the full worker registration.
 *
 * Deliberately bypasses AutomationService.ingestEvent(): that method is the
 * human-actor HTTP path (auth checks, actorType:'user' audit) — this is a
 * trusted system-to-system handoff, the same category as runScheduleSweep's
 * direct repository insert. Callers are expected to rethrow on failure so
 * pg-boss retry (governed by the relay's own retryLimit/retryBackoff) applies
 * as the single retry owner — this function itself never retries.
 */
export declare function ingestAlertDomainEvent(data: AlertDomainEventJobData, repo: AutomationRepository, auditRepo: AutomationAuditRepository, log: FastifyBaseLogger): Promise<{
    created: boolean;
    skippedReason?: 'not_entitled';
}>;
export declare function handleStepFailure(step: {
    id: string;
    runId?: string;
    attempt: number;
    maxAttempts: number;
    metadata: Record<string, unknown>;
}, errorCode: string, errorMessage: string, output: Record<string, unknown>, repo: AutomationRepository, log: FastifyBaseLogger, runId?: string, orgId?: string): Promise<StepFailureOutcome>;
/**
 * Register all automation pg-boss workers.
 * Called from shared/workers/main.ts during lifecycle bootstrap.
 * Returns a stop handle for graceful unschedule.
 */
export declare function registerAutomationWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=workers.d.ts.map