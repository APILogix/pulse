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
export declare const AUTOMATION_QUEUES: {
    readonly inbox: "automation-inbox";
    readonly execute: "automation-run-execute";
    readonly maintenance: "automation-maintenance";
    readonly deadLetter: "automation-dead-letter";
    readonly schedule: "automation-schedule";
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
/**
 * Register all automation pg-boss workers.
 * Called from shared/workers/main.ts during lifecycle bootstrap.
 * Returns a stop handle for graceful unschedule.
 */
export declare function registerAutomationWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=workers.d.ts.map