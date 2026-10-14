import { pgmq } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { AutomationRepository, AUTOMATION_TRIGGER_COLUMNS } from './repository.js';
import { AutomationAuditRepository } from './audit.js';
import { ActionRunnerRegistry, buildIdempotencyKey, readActionWaitSeconds } from './action-runner.js';
import { createAutomationIntegrations } from './integrations.js';
import { evaluateConditions } from './evaluator.js';
import { pool } from '../../config/database.js';
import { nextCronOccurrence } from './cron.js';
import { FEATURE_KEYS, ACTION_FEATURE_MAP, collectRequiredFeatureKeys } from './entitlements.js';
// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE NAMES
// ═══════════════════════════════════════════════════════════════════════════════
export const AUTOMATION_QUEUES = {
    inbox: 'automation_inbox',
    execute: 'automation_run_execute',
    maintenance: 'automation_maintenance',
    deadLetter: 'automation_dead_letter',
    schedule: 'automation_schedule',
    alertDomainEventIngest: 'automation_alert_domain_event',
};
// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const INBOX_BATCH_SIZE = 10;
const INBOX_CONCURRENCY = 2;
const EXECUTE_CONCURRENCY = 3;
const MAX_INBOX_RETRY_ATTEMPTS = 5;
const STALE_INBOX_MINUTES = 5;
const STALE_RUN_MINUTES = 30;
const APPROVAL_DEFAULT_TTL_HOURS = 24;
const MAX_RUNS_PER_HOUR_DEFAULT = 100;
/**
 * Enqueue an automation job (inbox event or run execution).
 * Exported for use by AutomationService and automation.module.ts wiring.
 * Preserves DB source of truth on send failure (logs but does not throw).
 */
export async function enqueueAutomationJob(job) {
    const queueName = job.type === 'automation.run.execute'
        ? AUTOMATION_QUEUES.execute
        : AUTOMATION_QUEUES.inbox;
    await pgmq.send(queueName, job.payload);
}
// ═══════════════════════════════════════════════════════════════════════════════
// INBOX PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Process inbox events idempotently:
 * 1. Claim batch via CTE FOR UPDATE SKIP LOCKED
 * 2. For each event: check entitlement, match workflows by source index,
 *    verify project/org guard, evaluate conditions, ATOMICALLY reserve
 *    execution slot + create run+steps on SAME client.
 * 3. On failure: bounded retry with exponential backoff
 */
async function processInbox(repo, auditRepo, log) {
    const workerId = `inbox-worker-${process.pid}-${Date.now()}`;
    const events = await repo.claimInboxEvents(workerId, INBOX_BATCH_SIZE);
    if (events.length === 0)
        return;
    log.debug({ count: events.length }, 'Claimed inbox events');
    for (const event of events) {
        try {
            const orgId = event.organizationId;
            if (!orgId) {
                await repo.completeInboxEvent(event.id);
                continue;
            }
            // 1. Current entitlement check
            const hasEntitlement = await repo.hasEntitlement(orgId, 'module_automation_enabled');
            if (!hasEntitlement) {
                await repo.failInboxEvent(event.id, 'Automation entitlement not active', null);
                continue;
            }
            // 2. Source-indexed matching: find enabled workflows matching source_module + source_event
            const matches = await repo.findMatchingWorkflows(orgId, event.sourceModule, event.eventType);
            if (matches.length === 0) {
                await repo.completeInboxEvent(event.id);
                continue;
            }
            for (const wf of matches) {
                // 3. HARDENED: Exact project match for project-scoped workflows (null does NOT match)
                if (wf.projectId) {
                    if (!event.projectId || wf.projectId !== event.projectId) {
                        continue;
                    }
                }
                // 4. Pin active version
                const version = await repo.getActiveVersion(wf.id);
                if (!version)
                    continue;
                // 5. Load version-bound conditions and actions
                const [conditions, actions, triggersR] = await Promise.all([
                    repo.getVersionConditions(wf.id, version.id),
                    repo.getVersionActions(wf.id, version.id),
                    pool.query(`SELECT ${AUTOMATION_TRIGGER_COLUMNS} FROM automation_triggers WHERE workflow_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [wf.id]),
                ]);
                // Check action-level entitlements for required features
                const requiredKeys = collectRequiredFeatureKeys(wf.triggerType ?? 'event', actions.map((a) => a.actionType));
                if (requiredKeys.length > 0) {
                    let hasActionEntitlement = true;
                    for (const k of requiredKeys) {
                        const has = await repo.hasEntitlement(orgId, k);
                        if (!has) {
                            hasActionEntitlement = false;
                            break;
                        }
                    }
                    if (!hasActionEntitlement) {
                        await auditRepo.insertAuditLog({
                            organizationId: orgId,
                            workflowId: wf.id,
                            actorType: 'system',
                            action: 'trigger.matched',
                            entityType: 'workflow',
                            entityId: wf.id,
                            metadata: { skipped: true, reason: 'missing_action_entitlements', requiredKeys },
                        });
                        continue;
                    }
                }
                // 6. Evaluate trigger conditions
                const condResult = evaluateConditions(event.payload, conditions);
                if (!condResult.matched) {
                    await auditRepo.insertAuditLog({
                        organizationId: orgId,
                        workflowId: wf.id,
                        actorType: 'system',
                        action: 'trigger.matched',
                        entityType: 'workflow',
                        entityId: wf.id,
                        metadata: { matched: false, reason: 'conditions_failed', trace: condResult.conditionResults },
                    });
                    continue;
                }
                // 7. Deterministic per-workflow run idempotency key
                const idempotencyKey = buildIdempotencyKey({
                    organizationId: orgId,
                    workflowId: wf.id,
                    runId: event.id,
                    stepId: version.id,
                });
                // 8. Atomically reserve execution slot & create run+steps
                const trigger = triggersR.rows[0] ?? null;
                const { run } = await repo.createRunWithSteps({
                    organizationId: orgId,
                    projectId: wf.projectId,
                    workflowId: wf.id,
                    workflowVersionId: version.id,
                    triggerId: trigger?.id ?? null,
                    inboxEventId: event.id,
                    triggerType: trigger?.triggerType ?? event.eventType,
                    sourceModule: 'automation',
                    inputPayload: event.payload,
                    idempotencyKey,
                    steps: actions.map((a, idx) => ({
                        actionId: a.id,
                        stepKey: `step_${idx + 1}`,
                        actionType: a.actionType,
                        sortOrder: a.sortOrder ?? idx + 1,
                        config: a.config,
                        retryLimit: a.retryLimit,
                        retryBackoffSeconds: a.retryBackoffSeconds,
                        timeoutSeconds: a.timeoutSeconds,
                    })),
                });
                // 9. Audit run creation & enqueue execution
                await auditRepo.insertAuditLog({
                    organizationId: orgId,
                    workflowId: wf.id,
                    runId: run.id,
                    actorType: 'system',
                    action: 'run.created',
                    entityType: 'run',
                    entityId: run.id,
                    metadata: { workflowVersion: version.version, stepCount: actions.length },
                });
                await enqueueAutomationJob({
                    type: 'automation.run.execute',
                    payload: { runId: run.id, orgId },
                });
            }
            await repo.completeInboxEvent(event.id);
        }
        catch (err) {
            log.error({ err, eventId: event.id }, 'Error processing inbox event');
            const nextAttempt = event.attempts + 1;
            const backoffMinutes = Math.pow(2, nextAttempt - 1);
            const retryAt = new Date(Date.now() + backoffMinutes * 60_000);
            await repo.failInboxEvent(event.id, err?.message ?? String(err), retryAt);
        }
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// RUN EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Execute a single queued automation run step-by-step.
 */
async function executeRun(runId, orgId, repo, auditRepo, actionRunner, log) {
    // 1. Current entitlement re-check before execution
    const hasEntitlement = await repo.hasEntitlement(orgId, 'module_automation_enabled');
    if (!hasEntitlement) {
        await repo.updateRunStatus(runId, {
            status: 'failed',
            errorCode: 'ENTITLEMENT_REVOKED',
            errorMessage: 'Automation entitlement is no longer active for this organization',
            completedAt: new Date(),
        });
        return;
    }
    // 2. Lock & fetch run
    const run = await repo.getRun(orgId, runId);
    if (!run || run.status === 'cancelled' || run.status === 'timed_out')
        return;
    if (run.organizationId !== orgId)
        return;
    // 3. Mark running if queued
    if (run.status === 'queued') {
        await repo.updateRunStatus(runId, { status: 'running', startedAt: new Date() });
        await auditRepo.insertAuditLog({
            organizationId: orgId, workflowId: run.workflowId, runId,
            actorType: 'system', action: 'run.started', entityType: 'run',
        });
    }
    // 4. Fetch steps in sequential order
    const steps = await repo.listRunSteps(runId, orgId);
    const stepOutputs = {};
    // Hydrate outputs from already-succeeded steps
    for (const s of steps) {
        if (s.status === 'succeeded' && s.outputPayload) {
            stepOutputs[`step_${s.sortOrder}`] = s.outputPayload;
            if (s.actionId)
                stepOutputs[s.actionId] = s.outputPayload;
        }
    }
    // 5. Execute steps sequentially
    for (const step of steps) {
        if (step.status === 'succeeded' || step.status === 'skipped')
            continue;
        if (step.status === 'waiting_approval') {
            log.debug({ runId, stepId: step.id }, 'Run paused: step waiting for approval');
            return;
        }
        if (step.status === 'queued' && step.nextRetryAt && step.nextRetryAt > new Date()) {
            log.debug({ runId, stepId: step.id, nextRetryAt: step.nextRetryAt }, 'Run paused: step retry delay not yet elapsed');
            return;
        }
        if (step.status === 'failed') {
            log.debug({ runId, stepId: step.id }, 'Run halted: step previously failed');
            return;
        }
        // Check approval requirement
        const actionConfig = step.metadata?.config;
        if (actionConfig?.requireApproval === true && step.status !== 'running') {
            const ttlHours = actionConfig.approvalTtlHours ?? APPROVAL_DEFAULT_TTL_HOURS;
            const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
            await repo.updateStepStatus(step.id, { status: 'waiting_approval' });
            await repo.createApproval({
                organizationId: orgId,
                workflowId: run.workflowId,
                runId,
                stepId: step.id,
                riskLevel: step.metadata?.riskLevel ?? 'medium',
                expiresAt,
                requestPayload: step.inputPayload,
            });
            await auditRepo.insertAuditLog({
                organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
                actorType: 'system', action: 'step.approval_requested', entityType: 'step',
                metadata: { expiresAt: expiresAt.toISOString() },
            });
            return;
        }
        // Check delay / wait action
        const waitSeconds = readActionWaitSeconds(actionConfig) ?? 0;
        if (waitSeconds > 0) {
            const resumeAt = new Date(Date.now() + waitSeconds * 1000);
            await repo.updateStepStatus(step.id, {
                status: 'queued',
                nextRetryAt: resumeAt,
            });
            await pgmq.send(AUTOMATION_QUEUES.execute, { runId, orgId }, { delaySeconds: waitSeconds });
            return;
        }
        // 6. Claim & start step execution
        await repo.updateStepStatus(step.id, {
            status: 'running',
            attempt: step.attempt + 1,
        });
        await auditRepo.insertAuditLog({
            organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
            actorType: 'system', action: 'step.started', entityType: 'step',
            metadata: { attempt: step.attempt + 1, actionType: step.actionType },
        });
        // 7. Execute action runner
        const ctx = {
            organizationId: orgId,
            projectId: run.projectId,
            workflowId: run.workflowId,
            runId,
            stepId: step.id,
            actionType: step.actionType,
            actionKey: step.stepKey,
            config: step.metadata?.config ?? {},
            inputPayload: run.inputPayload,
            idempotencyKey: buildIdempotencyKey({ organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id }),
            attempt: step.attempt + 1,
            maxAttempts: step.maxAttempts,
            timeoutSeconds: step.metadata?.timeoutSeconds ?? 30,
            riskLevel: step.metadata?.riskLevel ?? 'low',
            approvalGranted: step.requiresApproval,
            metadata: step.metadata ?? {},
        };
        try {
            const result = await actionRunner.execute(ctx);
            if (result.success) {
                await repo.updateStepStatus(step.id, {
                    status: 'succeeded',
                    outputPayload: result.output,
                    completedAt: new Date(),
                });
                stepOutputs[`step_${step.sortOrder}`] = result.output;
                if (step.actionId)
                    stepOutputs[step.actionId] = result.output;
                await auditRepo.insertAuditLog({
                    organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
                    actorType: 'system', action: 'step.completed', entityType: 'step',
                    metadata: { actionType: step.actionType },
                });
            }
            else {
                await handleStepFailure(step, result.errorCode ?? 'ACTION_FAILED', result.errorMessage ?? 'Action returned failure', result.output, repo, log, runId, orgId);
                await auditRepo.insertAuditLog({
                    organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
                    actorType: 'system', action: 'step.failed', entityType: 'step',
                    metadata: { errorCode: result.errorCode, actionType: step.actionType },
                });
            }
        }
        catch (err) {
            const errorMessage = err?.message ?? String(err);
            const isTimeout = errorMessage.includes('timed out');
            const errorCode = isTimeout ? 'STEP_TIMEOUT' : 'STEP_ERROR';
            if (isTimeout) {
                await repo.updateStepStatus(step.id, { status: 'timed_out', errorCode, errorMessage, completedAt: new Date() });
                await auditRepo.insertAuditLog({
                    organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
                    actorType: 'system', action: 'step.failed', entityType: 'step',
                    metadata: { errorCode, timeout: true, actionType: step.actionType },
                });
            }
            else {
                const outcome = await handleStepFailure(step, errorCode, errorMessage, {}, repo, log, runId, orgId);
                await auditRepo.insertAuditLog({
                    organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
                    actorType: 'system', action: 'step.failed', entityType: 'step',
                    metadata: { errorCode, actionType: step.actionType },
                });
                if (outcome.retryScheduled && !outcome.retryEnqueued) {
                    throw err;
                }
            }
        }
    }
    // 8. Aggregate run completion
    const finalStatus = await repo.aggregateRunCompletion(runId);
    if (finalStatus) {
        await repo.updateRunStatus(runId, {
            status: finalStatus,
            completedAt: new Date(),
        });
        await pool.query(`UPDATE automation_workflows SET last_run_at = NOW(), updated_at = NOW() WHERE id = $1`, [run.workflowId]);
        const auditAction = finalStatus === 'succeeded' ? 'run.completed' : 'run.failed';
        await auditRepo.insertAuditLog({
            organizationId: orgId, workflowId: run.workflowId, runId,
            actorType: 'system', action: auditAction, entityType: 'run',
            metadata: { finalStatus },
        });
    }
}
export async function ingestAlertDomainEvent(data, repo, auditRepo, log) {
    const entitled = await repo.hasEntitlement(data.organizationId, 'module_automation_enabled');
    if (!entitled)
        return { created: false, skippedReason: 'not_entitled' };
    const result = await repo.insertInboxEvent({
        organizationId: data.organizationId,
        projectId: data.projectId,
        sourceModule: 'alerting',
        eventType: data.eventType,
        sourceEventId: data.alertEventId,
        dedupeKey: data.dedupeKey,
        payload: data.payload,
        metadata: { ...data.metadata, bridgedFrom: 'alerting', alertKey: data.alertKey },
    });
    if (result.created) {
        await auditRepo.insertAuditLog({
            organizationId: data.organizationId,
            actorType: 'system',
            action: 'trigger.received',
            entityType: 'inbox_event',
            entityId: result.event.id,
            metadata: { sourceModule: 'alerting', eventType: data.eventType, alertKey: data.alertKey },
        });
        try {
            await enqueueAutomationJob({ type: 'automation.inbox.process', payload: { eventId: result.event.id, orgId: data.organizationId } });
        }
        catch (enqErr) {
            log.warn({ err: enqErr, eventId: result.event.id }, 'Failed to enqueue inbox processing for bridged alert event');
        }
    }
    return { created: result.created };
}
export async function handleStepFailure(step, errorCode, errorMessage, output, repo, log, runId, orgId) {
    const retryBackoff = step.metadata?.retryBackoffSeconds ?? 30;
    if (step.attempt < step.maxAttempts) {
        const backoffMs = Math.min(retryBackoff * 1000 * Math.pow(2, step.attempt - 1), 3_600_000);
        const nextRetryAt = new Date(Date.now() + backoffMs);
        await repo.updateStepStatus(step.id, {
            status: 'queued',
            errorCode,
            errorMessage,
            outputPayload: output,
            nextRetryAt,
        });
        const effectiveRunId = runId ?? step.runId;
        let retryEnqueued = false;
        if (effectiveRunId && orgId) {
            try {
                await pgmq.send(AUTOMATION_QUEUES.execute, { runId: effectiveRunId, orgId }, { delaySeconds: Math.ceil(backoffMs / 1000) });
                retryEnqueued = true;
            }
            catch (enqErr) {
                log.warn({ err: enqErr, stepId: step.id }, 'Failed to enqueue retry job');
            }
        }
        log.debug({ stepId: step.id, attempt: step.attempt, nextRetryAt, retryEnqueued }, 'Step scheduled for retry');
        return { retryScheduled: true, retryEnqueued };
    }
    await repo.updateStepStatus(step.id, {
        status: 'failed',
        errorCode,
        errorMessage,
        outputPayload: output,
        completedAt: new Date(),
    });
    return { retryScheduled: false, retryEnqueued: false };
}
// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE WORKER
// ═══════════════════════════════════════════════════════════════════════════════
async function runMaintenance(repo, log) {
    try {
        const expiredApprovals = await repo.expireStaleApprovals();
        if (expiredApprovals > 0)
            log.info({ expiredApprovals }, 'Expired stale automation approvals');
        const recoveredSteps = await repo.recoverStaleSteps();
        if (recoveredSteps > 0)
            log.info({ recoveredSteps }, 'Recovered stale automation steps');
        const recoveredRuns = await repo.recoverStaleRuns(STALE_RUN_MINUTES);
        if (recoveredRuns > 0)
            log.info({ recoveredRuns }, 'Recovered stale automation runs');
        const runnableRuns = await repo.findRunnableRunsForReenqueue(50);
        for (const { runId, orgId } of runnableRuns) {
            try {
                await pgmq.send(AUTOMATION_QUEUES.execute, { runId, orgId });
            }
            catch (enqErr) {
                log.warn({ err: enqErr, runId }, 'Failed to re-enqueue runnable run during maintenance');
            }
        }
        const recoveredInbox = await pool.query(`UPDATE automation_events_inbox
       SET status = 'retry', locked_at = NULL, locked_by = NULL,
           next_retry_at = NOW() + INTERVAL '30 seconds'
       WHERE status = 'processing'
         AND locked_at < NOW() - ($1 || ' minutes')::interval`, [STALE_INBOX_MINUTES.toString()]);
        const inboxCount = recoveredInbox.rowCount ?? 0;
        if (inboxCount > 0)
            log.info({ recoveredInbox: inboxCount }, 'Recovered stale inbox events');
    }
    catch (err) {
        log.error({ err }, 'Automation maintenance sweep failed');
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE DUE SWEEP
// ═══════════════════════════════════════════════════════════════════════════════
async function runScheduleSweep(repo, auditRepo, log) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dueR = await client.query(`SELECT w.id AS workflow_id, w.organization_id, w.project_id, t.id AS trigger_id,
              t.schedule_cron, t.trigger_type, t.source_module, t.cooldown_seconds,
              t.timezone AS trigger_timezone, w.next_run_at
       FROM automation_workflows w
       JOIN automation_triggers t ON t.workflow_id = w.id AND t.deleted_at IS NULL
       WHERE w.is_enabled = TRUE
         AND w.deleted_at IS NULL
         AND t.trigger_kind = 'schedule'
         AND t.schedule_cron IS NOT NULL
         AND t.is_enabled = TRUE
         AND (w.next_run_at IS NULL OR w.next_run_at <= NOW())
       ORDER BY w.next_run_at ASC NULLS FIRST
       LIMIT 50
       FOR UPDATE OF w SKIP LOCKED`);
        for (const row of dueR.rows) {
            const tz = row.trigger_timezone ?? 'UTC';
            const isNullInit = row.next_run_at === null;
            const dueTimestamp = row.next_run_at;
            let nextRun;
            try {
                nextRun = nextCronOccurrence(row.schedule_cron, new Date(), tz);
            }
            catch (cronErr) {
                log.error({ err: cronErr, workflowId: row.workflow_id }, 'Invalid cron expression — disabling schedule');
                await client.query(`UPDATE automation_workflows SET is_enabled = FALSE, status = 'disabled', updated_at = NOW()
           WHERE id = $1`, [row.workflow_id]);
                await client.query(`INSERT INTO automation_audit_logs
            (organization_id, workflow_id, actor_type, action, entity_type, entity_id, metadata)
           VALUES ($1,$2,'system','workflow.disabled','workflow',$2,$3::jsonb)`, [row.organization_id, row.workflow_id, JSON.stringify({ reason: 'invalid_cron', cron: row.schedule_cron, error: String(cronErr) })]);
                continue;
            }
            if (nextRun) {
                await client.query(`UPDATE automation_workflows SET next_run_at = $2, updated_at = NOW()
           WHERE id = $1`, [row.workflow_id, nextRun.toISOString()]);
            }
            else {
                await client.query(`UPDATE automation_workflows SET next_run_at = NULL, updated_at = NOW()
           WHERE id = $1`, [row.workflow_id]);
            }
            if (isNullInit)
                continue;
            const dueIso = dueTimestamp ? dueTimestamp.toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
            const dedupeKey = `schedule:${row.organization_id}:${row.workflow_id}:${dueIso}`;
            await client.query(`INSERT INTO automation_events_inbox
          (organization_id, project_id, source_module, event_type, source_event_id, dedupe_key, payload, metadata)
         VALUES ($1,$2,'automation','schedule.cron',$3,$3,$4::jsonb,$5::jsonb)
         ON CONFLICT (organization_id, dedupe_key) WHERE organization_id IS NOT NULL DO NOTHING`, [
                row.organization_id, row.project_id, dedupeKey,
                JSON.stringify({ scheduleCron: row.schedule_cron, triggerId: row.trigger_id, timezone: tz, dueAt: dueIso }),
                JSON.stringify({ scheduled: true }),
            ]);
        }
        await client.query('COMMIT');
        if (dueR.rows.length > 0) {
            log.debug({ count: dueR.rows.length }, 'Schedule sweep processed');
        }
    }
    catch (err) {
        await client.query('ROLLBACK');
        log.error({ err }, 'Schedule sweep failed');
    }
    finally {
        client.release();
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// REGISTER WORKERS
// ═══════════════════════════════════════════════════════════════════════════════
export async function registerAutomationWorkers(logger) {
    const log = logger.child({ component: 'automation-workers' });
    const repo = new AutomationRepository(pool);
    const auditRepo = new AutomationAuditRepository(pool);
    const actionRunner = new ActionRunnerRegistry(createAutomationIntegrations({ pool, logger: log, automationRepository: repo }));
    await pgmq.createQueues(Object.values(AUTOMATION_QUEUES), { concurrency: 4 });
    const workers = [];
    // ── Inbox Worker ──────────────────────────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async () => {
        await processInbox(repo, auditRepo, log);
    }, { queue: AUTOMATION_QUEUES.inbox, batchSize: 1, concurrency: INBOX_CONCURRENCY }));
    // ── Execute Worker ────────────────────────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async (msg) => {
        const { runId, orgId } = msg.message;
        if (!runId || !orgId)
            return;
        await executeRun(runId, orgId, repo, auditRepo, actionRunner, log);
    }, { queue: AUTOMATION_QUEUES.execute, batchSize: 1, concurrency: EXECUTE_CONCURRENCY }));
    // ── Alert Domain Event Ingest Worker ──────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async (msg) => {
        await ingestAlertDomainEvent(msg.message, repo, auditRepo, log);
    }, { queue: AUTOMATION_QUEUES.alertDomainEventIngest, batchSize: 5, concurrency: 2 }));
    // ── Maintenance Worker ────────────────────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async () => {
        await runMaintenance(repo, log);
    }, { queue: AUTOMATION_QUEUES.maintenance, batchSize: 1, concurrency: 1 }));
    // ── Schedule Worker ───────────────────────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async () => {
        await runScheduleSweep(repo, auditRepo, log);
    }, { queue: AUTOMATION_QUEUES.schedule, batchSize: 1, concurrency: 1 }));
    // ── Dead-letter Worker ────────────────────────────────────────────────────
    workers.push(new PgmqWorker(pgmq, async (msg) => {
        const data = msg.message ?? {};
        const runId = data.runId ?? null;
        const orgId = data.orgId ?? null;
        if (!orgId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
            return;
        }
        await auditRepo.insertAuditLog({
            organizationId: orgId,
            workflowId: data.workflowId ?? null,
            runId,
            actorType: 'system',
            action: 'run.dead_lettered',
            entityType: 'run',
            entityId: runId,
            metadata: {
                jobId: msg.msgId,
                exhaustedData: data,
                reason: 'Job exhausted all PGMQ retries',
                persistedAt: new Date().toISOString(),
            },
        });
        if (runId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
            await repo.updateRunStatus(runId, {
                status: 'failed',
                errorCode: 'DEAD_LETTERED',
                errorMessage: 'Job exhausted all retries and was dead-lettered',
                completedAt: new Date(),
            });
        }
    }, { queue: AUTOMATION_QUEUES.deadLetter, batchSize: 5, concurrency: 1 }));
    await Promise.all(workers.map((w) => w.start()));
    // ── Periodic Sweeps ───────────────────────────────────────────────────────
    const sweepTimers = [
        setInterval(() => void pgmq.send(AUTOMATION_QUEUES.inbox, {}).catch(() => undefined), 60_000),
        setInterval(() => void pgmq.send(AUTOMATION_QUEUES.maintenance, {}).catch(() => undefined), 120_000),
        setInterval(() => void pgmq.send(AUTOMATION_QUEUES.schedule, {}).catch(() => undefined), 60_000),
    ];
    for (const timer of sweepTimers)
        timer.unref();
    log.info({ queues: AUTOMATION_QUEUES }, 'Automation PGMQ workers registered');
    return {
        stop: async () => {
            for (const t of sweepTimers)
                clearInterval(t);
            await Promise.all(workers.map((w) => w.stop()));
            log.info('Automation workers stopped');
        },
    };
}
//# sourceMappingURL=workers.js.map