/**
 * Automation Module – Supabase PGMQ worker registration.
 *
 * Queues:
 *   - automation_inbox              Process pending inbox events → match → create runs
 *   - automation_run_execute        Execute queued runs sequentially (step-by-step)
 *   - automation_maintenance        Expire approvals, recover stale inbox/runs/steps
 *   - automation_dead_letter        Dead-letter retry for failed inbox events
 *   - automation_schedule           Bounded cron due-scheduling sweep
 *   - automation_alert_domain_event Ingest alert lifecycle events into automation inbox
 */
import type { FastifyBaseLogger } from 'fastify';
import { AutomationRepository } from './repository.js';
import { AutomationAuditRepository } from './audit.js';
export declare const AUTOMATION_QUEUES: {
    readonly inbox: "automation_inbox";
    readonly execute: "automation_run_execute";
    readonly maintenance: "automation_maintenance";
    readonly deadLetter: "automation_dead_letter";
    readonly schedule: "automation_schedule";
    readonly alertDomainEventIngest: "automation_alert_domain_event";
};
export interface InboxJobData {
    batchSize?: number;
    eventId?: string;
    orgId?: string;
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
export interface StepFailureOutcome {
    retryScheduled: boolean;
    retryEnqueued: boolean;
}
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
export declare function registerAutomationWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=workers.d.ts.map