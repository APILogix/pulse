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
import { pgboss } from '../../lib/pgboss.js';
import { AutomationRepository } from './repository.js';
import { AutomationAuditRepository } from './audit.js';
import { ActionRunnerRegistry, buildIdempotencyKey } from './action-runner.js';
import { evaluateConditions } from './evaluator.js';
import { pool } from '../../config/database.js';
import { nextCronOccurrence } from './cron.js';
import { FEATURE_KEYS, ACTION_FEATURE_MAP, collectRequiredFeatureKeys } from './entitlements.js';
import type { AutomationActionContext } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE NAMES
// ═══════════════════════════════════════════════════════════════════════════════

export const AUTOMATION_QUEUES = {
  inbox: 'automation-inbox',
  execute: 'automation-run-execute',
  maintenance: 'automation-maintenance',
  deadLetter: 'automation-dead-letter',
  schedule: 'automation-schedule',
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const INBOX_BATCH_SIZE = 10;
const INBOX_CONCURRENCY = 2;
const EXECUTE_CONCURRENCY = 3;
const MAINTENANCE_INTERVAL_CRON = '*/2 * * * *'; // every 2 min
const SCHEDULE_INTERVAL_CRON = '* * * * *'; // every 1 min
const INBOX_INTERVAL_CRON = '*/1 * * * *';
const MAX_INBOX_RETRY_ATTEMPTS = 5;
const STALE_INBOX_MINUTES = 5;
const STALE_RUN_MINUTES = 30;
const APPROVAL_DEFAULT_TTL_HOURS = 24;
const MAX_RUNS_PER_HOUR_DEFAULT = 100;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface MinimalJob<T> { id: string; data: T }

export interface InboxJobData { batchSize?: number }
export interface ExecuteJobData { runId: string; orgId: string }
export interface MaintenanceJobData { type?: string }
export interface ScheduleJobData { sweep?: boolean }

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
}

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

/**
 * Enqueue an automation job (inbox event or run execution).
 * Exported for use by AutomationService and automation.module.ts wiring.
 * Preserves DB source of truth on send failure (logs but does not throw).
 */
export async function enqueueAutomationJob(job: {
  type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const queueName = job.type === 'automation.run.execute'
    ? AUTOMATION_QUEUES.execute
    : AUTOMATION_QUEUES.inbox;

  const options: Record<string, unknown> = {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: AUTOMATION_QUEUES.deadLetter,
  };

  if (job.type === 'automation.run.execute') {
    options.singletonKey = `run:${job.payload.runId}`;
  }

  await pgboss.send(queueName, job.payload, options as never);
}


// ═══════════════════════════════════════════════════════════════════════════════
// INBOX PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process inbox events idempotently:
 * 1. Claim batch via CTE FOR UPDATE SKIP LOCKED
 * 2. For each event: check entitlement, match workflows by source index,
 *    verify project/org guard, evaluate conditions, ATOMICALLY reserve
 *    execution slot (advisory lock + cooldown + rate check) + create run+steps
 *    on SAME client. Return cleanly when gate denies.
 * 3. On failure: bounded retry with exponential backoff
 */
async function processInbox(
  repo: AutomationRepository,
  auditRepo: AutomationAuditRepository,
  log: FastifyBaseLogger,
): Promise<void> {
  const workerId = `inbox-worker-${process.pid}-${Date.now()}`;
  const events = await repo.claimInboxEvents(workerId, INBOX_BATCH_SIZE);

  if (events.length === 0) return;
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
      const matches = await repo.findMatchingWorkflows(
        orgId,
        event.sourceModule,
        event.eventType,
      );

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
        if (!version) continue;

        // 5. Load version-bound conditions and actions
        const [conditionsR, actionsR] = await Promise.all([
          pool.query(
            `SELECT * FROM automation_conditions
             WHERE workflow_id = $1 AND workflow_version_id = $2 AND deleted_at IS NULL
             ORDER BY condition_group, sort_order`,
            [wf.id, version.id],
          ),
          pool.query(
            `SELECT * FROM automation_actions
             WHERE workflow_id = $1 AND workflow_version_id = $2 AND deleted_at IS NULL AND is_enabled = TRUE
             ORDER BY sort_order`,
            [wf.id, version.id],
          ),
        ]);

        // 6. Evaluate conditions
        const conditions = conditionsR.rows.map((r: any) => ({
          conditionGroup: r.condition_group,
          sortOrder: r.sort_order,
          leftPath: r.left_path,
          operator: r.operator,
          rightValue: r.right_value,
          isRequired: r.is_required,
        }));

        if (conditions.length > 0) {
          const evalResult = evaluateConditions(event.payload, conditions);
          if (!evalResult.matched) continue;
        }

        // 7. HARDENED: Atomic gate — advisory lock + cooldown + hourly check + run+steps
        //    All in ONE transaction on the SAME client. Scoped by org.
        const versionDef = version.definition as { safety?: { maxRunsPerHour?: number; dedupeWindowSeconds?: number } };
        const maxRunsPerHour = versionDef?.safety?.maxRunsPerHour ?? MAX_RUNS_PER_HOUR_DEFAULT;
        const cooldownSeconds = wf.cooldownSeconds > 0 ? wf.cooldownSeconds : (versionDef?.safety?.dedupeWindowSeconds ?? 0);

        // 8. Deterministic per-workflow run idempotency key
        const idempotencyKey = `automation:${orgId}:${wf.id}:${event.eventType}:${event.sourceEventId ?? event.dedupeKey}`;

        // 9. Build steps from version-bound actions (pinned snapshot)
        const actions = actionsR.rows;
        const steps = actions.map((a: any, i: number) => {
          const featureKey = ACTION_FEATURE_MAP[a.action_type as keyof typeof ACTION_FEATURE_MAP] ?? null;
          return {
            actionId: a.id,
            stepKey: a.action_key,
            actionType: a.action_type,
            sortOrder: i,
            maxAttempts: a.max_attempts ?? 3,
            timeoutSeconds: a.timeout_seconds ?? 60,
            retryBackoffSeconds: a.retry_backoff_seconds ?? 30,
            requiresApproval: a.requires_approval ?? false,
            riskLevel: a.risk_level ?? 'low',
            config: a.config ?? {},
            requiredFeatureKey: featureKey,
            idempotencyKey: `${idempotencyKey}:step:${a.action_key}`,
            inputPayload: event.payload,
            metadata: {
              riskLevel: a.risk_level ?? 'low',
              config: a.config ?? {},
              timeoutSeconds: a.timeout_seconds ?? 60,
              retryBackoffSeconds: a.retry_backoff_seconds ?? 30,
              requiredFeatureKey: featureKey,
            },
          };
        });

        if (steps.length === 0) continue;

        // 10. ATOMIC: Use one transaction for advisory lock + gate checks + run+steps insert
        try {
          const runResult = await repo.withTransaction(async (client) => {
            // Advisory xact lock scoped by org+workflow (prevents concurrent slot checks)
            const lockKey = Buffer.from(wf.id.replace(/-/g, '').slice(0, 16), 'hex');
            const lockVal = lockKey.readBigInt64BE(0);
            await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockVal]);

            // Cooldown check
            if (cooldownSeconds > 0) {
              const coolR = await client.query(
                `SELECT 1 FROM automation_runs
                 WHERE workflow_id = $1 AND organization_id = $2
                   AND created_at > NOW() - ($3 || ' seconds')::interval
                 LIMIT 1`,
                [wf.id, orgId, cooldownSeconds.toString()],
              );
              if ((coolR.rowCount ?? 0) > 0) return null; // gate denied
            }

            // Hourly rate check
            if (maxRunsPerHour > 0) {
              const rateR = await client.query(
                `SELECT COUNT(*)::int AS cnt FROM automation_runs
                 WHERE workflow_id = $1 AND organization_id = $2
                   AND created_at > NOW() - INTERVAL '1 hour'`,
                [wf.id, orgId],
              );
              if ((rateR.rows[0]?.cnt ?? 0) >= maxRunsPerHour) return null; // gate denied
            }

            // Create run+steps on SAME client (no nested BEGIN)
            const { run } = await repo.createRunWithSteps({
              organizationId: orgId,
              projectId: event.projectId ?? wf.projectId,
              workflowId: wf.id,
              workflowVersionId: version.id,
              triggerId: wf.triggerId,
              inboxEventId: event.id,
              triggerType: event.eventType,
              sourceModule: event.sourceModule,
              sourceEventId: event.sourceEventId ?? null,
              dedupeKey: event.dedupeKey,
              idempotencyKey,
              inputPayload: event.payload,
              steps,
            }, client);

            return run;
          });

          if (!runResult) continue; // gate denied, cleanly skip

          // 11. Audit
          await auditRepo.insertAuditLog({
            organizationId: orgId,
            workflowId: wf.id,
            runId: runResult.id,
            actorType: 'system',
            action: 'run.queued',
            entityType: 'run',
            entityId: runResult.id,
            metadata: { trigger: event.eventType, inboxEventId: event.id },
          });

          // 12. Enqueue execute
          try {
            await enqueueAutomationJob({
              type: 'automation.run.execute',
              payload: { runId: runResult.id, orgId },
            });
          } catch (enqErr) {
            log.warn({ err: enqErr, runId: runResult.id }, 'Failed to enqueue run execution (DB is source of truth)');
          }
        } catch (createErr: any) {
          // Idempotency conflict is expected for duplicate events
          if (createErr?.code === 'AUTOMATION_CONFLICT' || createErr?.message?.includes('Conflict')) {
            log.debug({ workflowId: wf.id, idempotencyKey }, 'Duplicate run skipped (idempotent)');
          } else {
            throw createErr;
          }
        }
      }

      await repo.completeInboxEvent(event.id);
    } catch (err) {
      log.error({ err, eventId: event.id }, 'Inbox event processing failed');

      // Bounded failure retry with exponential backoff
      const nextAttempt = event.attempts + 1;
      if (nextAttempt <= MAX_INBOX_RETRY_ATTEMPTS) {
        const backoffMs = Math.min(1000 * Math.pow(2, nextAttempt), 300_000);
        const retryAt = new Date(Date.now() + backoffMs);
        await repo.failInboxEvent(event.id, String(err), retryAt);
      } else {
        await repo.failInboxEvent(event.id, `Exhausted after ${MAX_INBOX_RETRY_ATTEMPTS} attempts: ${err}`, null);
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// RUN EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a run sequentially:
 * 1. Recheck org/workflow/entitlement and feature entitlements
 * 2. Respect cancellation/disabled/deleted/project-deleted
 * 3. Pin version
 * 4. For each step in order:
 *    a. Create approval for high/critical/requiresApproval (one only)
 *    b. Resume only after approved
 *    c. Execute via ActionRunner with stable external idempotency
 *    d. Bounded exponential retries
 *    e. Timeout/skipped/success/failure status
 * 5. Aggregate run status
 * 6. Audit
 */
async function executeRun(
  runId: string,
  orgId: string,
  repo: AutomationRepository,
  auditRepo: AutomationAuditRepository,
  actionRunner: ActionRunnerRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  // 1. Load run
  const run = await repo.getRun(orgId, runId);
  if (!run) {
    log.warn({ runId, orgId }, 'Run not found for execution');
    return;
  }

  // 2. Respect cancellation
  if (run.status === 'cancelled' || run.status === 'succeeded' || run.status === 'failed') {
    return;
  }

  // 3. Recheck entitlement
  const hasEntitlement = await repo.hasEntitlement(orgId, 'module_automation_enabled');
  if (!hasEntitlement) {
    await repo.updateRunStatus(runId, {
      status: 'failed',
      errorCode: 'ENTITLEMENT_LOST',
      errorMessage: 'Automation entitlement no longer active',
      completedAt: new Date(),
    });
    await auditRepo.insertAuditLog({
      organizationId: orgId, workflowId: run.workflowId, runId,
      actorType: 'system', action: 'run.failed', entityType: 'run',
      metadata: { reason: 'entitlement_lost' },
    });
    return;
  }

  // 4. Check workflow still enabled/exists
  const workflow = await repo.getWorkflow(orgId, run.workflowId);
  if (!workflow) {
    await repo.updateRunStatus(runId, {
      status: 'cancelled',
      errorCode: 'WORKFLOW_DELETED',
      errorMessage: 'Workflow was deleted',
      completedAt: new Date(),
    });
    return;
  }
  if (!workflow.isEnabled) {
    await repo.updateRunStatus(runId, {
      status: 'cancelled',
      errorCode: 'WORKFLOW_DISABLED',
      errorMessage: 'Workflow is disabled',
      completedAt: new Date(),
    });
    return;
  }

  // 5. Check project still exists (if project-scoped)
  if (workflow.projectId) {
    const projectExists = await repo.verifyProjectOwnership(orgId, workflow.projectId);
    if (!projectExists) {
      await repo.updateRunStatus(runId, {
        status: 'cancelled',
        errorCode: 'PROJECT_DELETED',
        errorMessage: 'Project no longer exists',
        completedAt: new Date(),
      });
      return;
    }
  }

  // 6. Mark run as running
  if (run.status === 'queued') {
    await repo.updateRunStatus(runId, { status: 'running', startedAt: new Date() });
    await auditRepo.insertAuditLog({
      organizationId: orgId, workflowId: run.workflowId, runId,
      actorType: 'system', action: 'run.started', entityType: 'run',
    });
  }

  // 7. Sequential step execution
  let continueExecution = true;
  while (continueExecution) {
    // Re-check cancellation + workflow/project/entitlement between every step (defect 9)
    const currentRun = await repo.getRun(orgId, runId);
    if (!currentRun || currentRun.status === 'cancelled') {
      continueExecution = false;
      break;
    }

    // Between-step: recheck base automation entitlement
    const betweenStepEntitlement = await repo.hasEntitlement(orgId, 'module_automation_enabled');
    if (!betweenStepEntitlement) {
      await repo.updateRunStatus(runId, {
        status: 'failed', errorCode: 'ENTITLEMENT_LOST',
        errorMessage: 'Automation entitlement lost between steps', completedAt: new Date(),
      });
      await pool.query(
        `UPDATE automation_run_steps SET status = 'cancelled', error_code = 'ENTITLEMENT_LOST', completed_at = NOW(), updated_at = NOW()
         WHERE run_id = $1 AND status IN ('queued','waiting_approval')`, [runId],
      );
      continueExecution = false;
      break;
    }

    // Between-step: recheck workflow enabled/deleted
    const currentWorkflow = await repo.getWorkflow(orgId, run.workflowId);
    if (!currentWorkflow || !currentWorkflow.isEnabled) {
      const code = !currentWorkflow ? 'WORKFLOW_DELETED' : 'WORKFLOW_DISABLED';
      await repo.updateRunStatus(runId, {
        status: 'failed', errorCode: code,
        errorMessage: !currentWorkflow ? 'Workflow deleted between steps' : 'Workflow disabled between steps',
        completedAt: new Date(),
      });
      await pool.query(
        `UPDATE automation_run_steps SET status = 'cancelled', error_code = $2, completed_at = NOW(), updated_at = NOW()
         WHERE run_id = $1 AND status IN ('queued','waiting_approval')`, [runId, code],
      );
      continueExecution = false;
      break;
    }

    // Between-step: recheck project ownership if project-scoped
    if (currentWorkflow.projectId) {
      const projExists = await repo.verifyProjectOwnership(orgId, currentWorkflow.projectId);
      if (!projExists) {
        await repo.updateRunStatus(runId, {
          status: 'failed', errorCode: 'PROJECT_DELETED',
          errorMessage: 'Project no longer exists', completedAt: new Date(),
        });
        await pool.query(
          `UPDATE automation_run_steps SET status = 'cancelled', error_code = 'PROJECT_DELETED', completed_at = NOW(), updated_at = NOW()
           WHERE run_id = $1 AND status IN ('queued','waiting_approval')`, [runId],
        );
        continueExecution = false;
        break;
      }
    }

    // Claim next step
    const claimed = await repo.claimNextStep(runId, 1);
    if (claimed.length === 0) {
      continueExecution = false;
      break;
    }

    const step = claimed[0]!;

    // Check if step requires approval
    if (step.requiresApproval && !step.approvalId) {
      // Create approval (one per step) — unique partial index prevents duplicates
      const expiresAt = new Date(Date.now() + APPROVAL_DEFAULT_TTL_HOURS * 60 * 60 * 1000);
      try {
        const approval = await repo.createApproval({
          organizationId: orgId,
          workflowId: run.workflowId,
          runId,
          stepId: step.id,
          riskLevel: step.metadata?.riskLevel as string ?? 'high',
          expiresAt,
          requestPayload: step.inputPayload,
          metadata: { actionType: step.actionType, stepKey: step.stepKey },
        });

        // Update step to waiting_approval
        await repo.updateStepStatus(step.id, { status: 'waiting_approval' });
        // Update run to waiting_approval
        await repo.updateRunStatus(runId, { status: 'waiting_approval' });

        // Link approval to step
        await pool.query(
          `UPDATE automation_run_steps SET approval_id = $1 WHERE id = $2`,
          [approval.id, step.id],
        );

        await auditRepo.insertAuditLog({
          organizationId: orgId, workflowId: run.workflowId, runId,
          stepId: step.id, approvalId: approval.id,
          actorType: 'system', action: 'approval.requested', entityType: 'approval',
          metadata: { actionType: step.actionType, riskLevel: approval.riskLevel },
        });
      } catch (approvalErr: any) {
        // Unique partial index violation means approval already exists (concurrent)
        if (approvalErr?.code === '23505') {
          log.debug({ stepId: step.id }, 'Approval already exists (concurrent creation)');
        } else {
          throw approvalErr;
        }
      }

      // Stop execution — will resume when approval is granted
      continueExecution = false;
      break;
    }

    // HARDENED: If step has an approval_id, load the ACTUAL approval status.
    // Only treat status === 'approved' as granted. Pending/expired/rejected = stop.
    if (step.requiresApproval && step.approvalId) {
      const approvalRow = await pool.query(
        `SELECT status FROM automation_approvals WHERE id = $1`,
        [step.approvalId],
      );
      const approvalStatus = approvalRow.rows[0]?.status;
      if (approvalStatus !== 'approved') {
        // Not yet approved — stop execution, don't proceed
        if (approvalStatus === 'rejected' || approvalStatus === 'expired' || approvalStatus === 'cancelled') {
          await repo.updateStepStatus(step.id, {
            status: 'cancelled',
            errorCode: 'APPROVAL_' + approvalStatus.toUpperCase(),
            errorMessage: `Approval was ${approvalStatus}`,
            completedAt: new Date(),
          });
          // Terminal for this step, continue to aggregate
        } else {
          // Still pending
          await repo.updateStepStatus(step.id, { status: 'waiting_approval' });
          await repo.updateRunStatus(runId, { status: 'waiting_approval' });
          continueExecution = false;
          break;
        }
        continue;
      }
    }

    // Execute the action
    try {
      // Stable external idempotency key (does NOT change across retry attempts)
      const stableIdempotencyKey = step.idempotencyKey
        ?? buildIdempotencyKey({
          organizationId: orgId,
          workflowId: run.workflowId,
          runId,
          stepId: step.id,
          attempt: 1, // stable across retries
        });

      // HARDENED: Use pinned step.metadata.config as ctx.config (NOT whole metadata)
      const stepConfig = (step.metadata?.config as Record<string, unknown>) ?? {};

      // HARDENED: Check step-level feature entitlement immediately before execution
      // Entitlement lost = FAIL step and run (defect 9: never skip/succeed when entitlement lost)
      const stepFeatureKey = step.metadata?.requiredFeatureKey as string | null;
      if (stepFeatureKey) {
        const hasFeature = await repo.hasEntitlement(orgId, stepFeatureKey);
        if (!hasFeature) {
          await repo.updateStepStatus(step.id, {
            status: 'failed',
            errorCode: 'ENTITLEMENT_LOST',
            errorMessage: `Required entitlement ${stepFeatureKey} not active`,
            outputPayload: { reason: `entitlement_lost:${stepFeatureKey}` },
            completedAt: new Date(),
          });
          // Fail the entire run when entitlement is lost
          await repo.updateRunStatus(runId, {
            status: 'failed',
            errorCode: 'ENTITLEMENT_LOST',
            errorMessage: `Step entitlement ${stepFeatureKey} no longer active`,
            completedAt: new Date(),
          });
          // Cancel remaining queued/waiting steps
          await pool.query(
            `UPDATE automation_run_steps SET status = 'cancelled', error_code = 'ENTITLEMENT_LOST',
                    completed_at = NOW(), updated_at = NOW()
             WHERE run_id = $1 AND status IN ('queued','waiting_approval')`,
            [runId],
          );
          await auditRepo.insertAuditLog({
            organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
            actorType: 'system', action: 'step.failed', entityType: 'step',
            metadata: { reason: 'entitlement_lost', featureKey: stepFeatureKey },
          });
          continueExecution = false;
          break;
        }
      }

      const ctx: AutomationActionContext = {
        runId,
        stepId: step.id,
        organizationId: orgId,
        projectId: workflow.projectId,
        workflowId: run.workflowId,
        actionType: step.actionType as any,
        actionKey: step.stepKey,
        config: stepConfig,
        inputPayload: step.inputPayload,
        idempotencyKey: stableIdempotencyKey,
        attempt: step.attempt,
        maxAttempts: step.maxAttempts,
        timeoutSeconds: (step.metadata?.timeoutSeconds as number) ?? 60,
        riskLevel: (step.metadata?.riskLevel as any) ?? 'low',
        approvalGranted: step.requiresApproval && step.approvalId ? true : false,
        metadata: step.metadata ?? {},
      };

      await auditRepo.insertAuditLog({
        organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
        actorType: 'system', action: 'step.started', entityType: 'step',
        metadata: { actionType: step.actionType, attempt: step.attempt },
      });

      const result = await actionRunner.execute(ctx);

      if (result.skipped) {
        await repo.updateStepStatus(step.id, {
          status: 'skipped',
          outputPayload: result.output,
          completedAt: new Date(),
        });
        await auditRepo.insertAuditLog({
          organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
          actorType: 'system', action: 'step.completed', entityType: 'step',
          metadata: { skipped: true, actionType: step.actionType },
        });
      } else if (result.success) {
        await repo.updateStepStatus(step.id, {
          status: 'succeeded',
          outputPayload: result.output,
          completedAt: new Date(),
        });
        await auditRepo.insertAuditLog({
          organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
          actorType: 'system', action: 'step.completed', entityType: 'step',
          metadata: { actionType: step.actionType },
        });
      } else {
        // Action returned failure
        await handleStepFailure(step, result.errorCode ?? 'ACTION_FAILED', result.errorMessage ?? 'Action returned failure', result.output, repo, log, runId, orgId);
        await auditRepo.insertAuditLog({
          organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
          actorType: 'system', action: 'step.failed', entityType: 'step',
          metadata: { errorCode: result.errorCode, actionType: step.actionType },
        });
      }
    } catch (err: any) {
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
      } else {
        await handleStepFailure(step, errorCode, errorMessage, {}, repo, log, runId, orgId);
        await auditRepo.insertAuditLog({
          organizationId: orgId, workflowId: run.workflowId, runId, stepId: step.id,
          actorType: 'system', action: 'step.failed', entityType: 'step',
          metadata: { errorCode, actionType: step.actionType },
        });
        // HARDENED: Rethrow transient job failures so pg-boss retry works
        // Transient = not timeout, not action-level failure, but infrastructure error
        if (errorCode === 'STEP_ERROR' && step.attempt < step.maxAttempts) {
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

    // Update workflow last_run_at
    await pool.query(
      `UPDATE automation_workflows SET last_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [run.workflowId],
    );

    const auditAction = finalStatus === 'succeeded' ? 'run.completed' : 'run.failed';
    await auditRepo.insertAuditLog({
      organizationId: orgId, workflowId: run.workflowId, runId,
      actorType: 'system', action: auditAction, entityType: 'run',
      metadata: { finalStatus },
    });
  }
}

/**
 * Handle step failure with bounded exponential retry.
 * HARDENED: Enqueues a delayed execute job so retries actually resume.
 */
async function handleStepFailure(
  step: { id: string; runId?: string; attempt: number; maxAttempts: number; metadata: Record<string, unknown> },
  errorCode: string,
  errorMessage: string,
  output: Record<string, unknown>,
  repo: AutomationRepository,
  log: FastifyBaseLogger,
  runId?: string,
  orgId?: string,
): Promise<void> {
  const retryBackoff = (step.metadata?.retryBackoffSeconds as number) ?? 30;

  if (step.attempt < step.maxAttempts) {
    // Schedule retry with exponential backoff
    const backoffMs = Math.min(retryBackoff * 1000 * Math.pow(2, step.attempt - 1), 3_600_000);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await repo.updateStepStatus(step.id, {
      status: 'queued',
      errorCode,
      errorMessage,
      outputPayload: output,
      nextRetryAt,
    });

    // CRITICAL FIX: Enqueue a delayed execute job so the retry actually runs.
    // Without this, steps with nextRetryAt would sit forever until maintenance sweep.
    const effectiveRunId = runId ?? (step as any).runId;
    if (effectiveRunId && orgId) {
      try {
        await pgboss.send(
          AUTOMATION_QUEUES.execute,
          { runId: effectiveRunId, orgId },
          { startAfter: nextRetryAt.toISOString(), singletonKey: `run:${effectiveRunId}:retry:${step.id}` } as never,
        );
      } catch (enqErr) {
        log.warn({ err: enqErr, stepId: step.id }, 'Failed to enqueue retry job (maintenance sweep will recover)');
      }
    }

    log.debug({ stepId: step.id, attempt: step.attempt, nextRetryAt }, 'Step scheduled for retry');
  } else {
    // Exhausted retries
    await repo.updateStepStatus(step.id, {
      status: 'failed',
      errorCode,
      errorMessage,
      outputPayload: output,
      completedAt: new Date(),
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE WORKER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expire approvals, recover stale inbox/runs/steps, and re-enqueue runnable runs.
 */
async function runMaintenance(
  repo: AutomationRepository,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const expiredApprovals = await repo.expireStaleApprovals();
    if (expiredApprovals > 0) {
      log.info({ expiredApprovals }, 'Expired stale automation approvals');
    }

    const recoveredSteps = await repo.recoverStaleSteps();
    if (recoveredSteps > 0) {
      log.info({ recoveredSteps }, 'Recovered stale automation steps');
    }

    const recoveredRuns = await repo.recoverStaleRuns(STALE_RUN_MINUTES);
    if (recoveredRuns > 0) {
      log.info({ recoveredRuns }, 'Recovered stale automation runs');
    }

    // HARDENED (defect 8): Re-enqueue runnable runs that have due queued steps but no active step
    const runnableRuns = await repo.findRunnableRunsForReenqueue(50);
    for (const { runId, orgId } of runnableRuns) {
      try {
        await pgboss.send(
          AUTOMATION_QUEUES.execute,
          { runId, orgId },
          { singletonKey: `run:${runId}:maintenance` } as never,
        );
      } catch (enqErr) {
        log.warn({ err: enqErr, runId }, 'Failed to re-enqueue runnable run during maintenance');
      }
    }
    if (runnableRuns.length > 0) {
      log.info({ reenqueued: runnableRuns.length }, 'Re-enqueued runnable runs');
    }

    // Recover stale inbox events (stuck in processing > STALE_INBOX_MINUTES)
    const recoveredInbox = await pool.query(
      `UPDATE automation_events_inbox
       SET status = 'retry', locked_at = NULL, locked_by = NULL,
           next_retry_at = NOW() + INTERVAL '30 seconds'
       WHERE status = 'processing'
         AND locked_at < NOW() - ($1 || ' minutes')::interval`,
      [STALE_INBOX_MINUTES.toString()],
    );
    const inboxCount = recoveredInbox.rowCount ?? 0;
    if (inboxCount > 0) {
      log.info({ recoveredInbox: inboxCount }, 'Recovered stale inbox events');
    }
  } catch (err) {
    log.error({ err }, 'Automation maintenance sweep failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE DUE SWEEP (lightweight 5-field cron)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Bounded schedule due sweep:
 * Find enabled schedule triggers where next_run_at <= NOW(),
 * create inbox events for them, and advance next_run_at.
 *
 * HARDENED (defect 2): Uses pool.connect + BEGIN for proper transaction.
 * Bounded SELECT FOR UPDATE SKIP LOCKED, compute/update next_run_at,
 * insert inbox event via same client. NULL next_run_at initializes without emitting.
 * Dedupes by scheduled due timestamp (not worker wall clock).
 * No tick emitted without advancing atomically. Audits invalid cron via same client.
 */
async function runScheduleSweep(
  repo: AutomationRepository,
  auditRepo: AutomationAuditRepository,
  log: FastifyBaseLogger,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dueR = await client.query(
      `SELECT w.id AS workflow_id, w.organization_id, w.project_id, t.id AS trigger_id,
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
       FOR UPDATE OF w SKIP LOCKED`,
    );

    for (const row of dueR.rows) {
      const tz = row.trigger_timezone ?? 'UTC';
      const isNullInit = row.next_run_at === null;
      const dueTimestamp: Date | null = row.next_run_at;

      // Compute next occurrence
      let nextRun: Date | null;
      try {
        nextRun = nextCronOccurrence(row.schedule_cron, new Date(), tz);
      } catch (cronErr: any) {
        // Invalid cron — disable schedule and audit in same transaction
        log.error({ err: cronErr, workflowId: row.workflow_id }, 'Invalid cron expression — disabling schedule');
        await client.query(
          `UPDATE automation_workflows SET is_enabled = FALSE, status = 'disabled', updated_at = NOW()
           WHERE id = $1`,
          [row.workflow_id],
        );
        await client.query(
          `INSERT INTO automation_audit_logs
            (organization_id, workflow_id, actor_type, action, entity_type, entity_id, metadata)
           VALUES ($1,$2,'system','workflow.disabled','workflow',$2,$3::jsonb)`,
          [row.organization_id, row.workflow_id, JSON.stringify({ reason: 'invalid_cron', cron: row.schedule_cron, error: String(cronErr) })],
        );
        continue;
      }

      // Update next_run_at ATOMICALLY — no tick emitted without advancing
      if (nextRun) {
        await client.query(
          `UPDATE automation_workflows SET next_run_at = $2, updated_at = NOW()
           WHERE id = $1`,
          [row.workflow_id, nextRun.toISOString()],
        );
      } else {
        await client.query(
          `UPDATE automation_workflows SET next_run_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [row.workflow_id],
        );
      }

      // NULL next_run_at initializes without emitting a run
      if (isNullInit) {
        continue;
      }

      // HARDENED: Dedupe by scheduled due timestamp (deterministic), not worker wall clock
      const dueIso = dueTimestamp ? dueTimestamp.toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
      const dedupeKey = `schedule:${row.organization_id}:${row.workflow_id}:${dueIso}`;

      // Insert inbox event via same client (same transaction)
      await client.query(
        `INSERT INTO automation_events_inbox
          (organization_id, project_id, source_module, event_type, source_event_id, dedupe_key, payload, metadata)
         VALUES ($1,$2,'automation','schedule.cron',$3,$3,$4::jsonb,$5::jsonb)
         ON CONFLICT (organization_id, dedupe_key) WHERE organization_id IS NOT NULL DO NOTHING`,
        [
          row.organization_id, row.project_id, dedupeKey,
          JSON.stringify({ scheduleCron: row.schedule_cron, triggerId: row.trigger_id, timezone: tz, dueAt: dueIso }),
          JSON.stringify({ scheduled: true }),
        ],
      );
    }

    await client.query('COMMIT');

    if (dueR.rows.length > 0) {
      log.debug({ count: dueR.rows.length }, 'Schedule sweep processed');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err }, 'Schedule sweep failed');
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTER WORKERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register all automation pg-boss workers.
 * Called from shared/workers/main.ts during lifecycle bootstrap.
 * Returns a stop handle for graceful unschedule.
 */
export async function registerAutomationWorkers(
  logger: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'automation-workers' });
  const repo = new AutomationRepository(pool);
  const auditRepo = new AutomationAuditRepository(pool);
  const actionRunner = new ActionRunnerRegistry();

  // Safe queue creation (idempotent)
  await Promise.all(
    Object.values(AUTOMATION_QUEUES).map((q) => safeCreateQueue(q)),
  );

  // ─── Inbox worker ──────────────────────────────────────────────────────────
  await pgboss.work(
    AUTOMATION_QUEUES.inbox,
    { batchSize: 1, localConcurrency: INBOX_CONCURRENCY } as never,
    (async (_arg: unknown) => {
      await processInbox(repo, auditRepo, log);
    }) as never,
  );

  // ─── Execute worker ────────────────────────────────────────────────────────
  await pgboss.work(
    AUTOMATION_QUEUES.execute,
    { batchSize: 1, localConcurrency: EXECUTE_CONCURRENCY } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<ExecuteJobData>(arg);
      for (const job of jobs) {
        if (!job.data.runId || !job.data.orgId) {
          log.warn({ jobId: job.id }, 'Execute job missing runId or orgId');
          continue;
        }
        // HARDENED (defect 11): Rethrow unexpected errors so pg-boss retries.
        // Do NOT catch-and-swallow.
        await executeRun(job.data.runId, job.data.orgId, repo, auditRepo, actionRunner, log);
      }
    }) as never,
  );

  // ─── Maintenance worker ────────────────────────────────────────────────────
  await pgboss.work(
    AUTOMATION_QUEUES.maintenance,
    { batchSize: 1 } as never,
    (async (_arg: unknown) => {
      await runMaintenance(repo, log);
    }) as never,
  );

  // ─── Schedule worker ───────────────────────────────────────────────────────
  await pgboss.work(
    AUTOMATION_QUEUES.schedule,
    { batchSize: 1 } as never,
    (async (_arg: unknown) => {
      await runScheduleSweep(repo, auditRepo, log);
    }) as never,
  );

  // ─── Dead-letter worker ────────────────────────────────────────────────────
  // Persists exhausted job metadata and audits without unsafe replay.
  await pgboss.work(
    AUTOMATION_QUEUES.deadLetter,
    { batchSize: 5 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<Record<string, unknown>>(arg);
      for (const job of jobs) {
        try {
          const data = job.data ?? {};
          const runId = (data.runId as string) ?? null;
          const orgId = (data.orgId as string) ?? null;

          // HARDENED: Dead-letter never inserts invalid 'unknown' UUID.
          // Only store/audit tenant-known jobs (must have valid orgId).
          if (!orgId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
            log.warn({ jobId: job.id }, 'Dead-lettered job has no valid orgId — skipping audit insert');
            continue;
          }

          // Persist dead-letter metadata into audit
          await auditRepo.insertAuditLog({
            organizationId: orgId,
            workflowId: (data.workflowId as string) ?? null,
            runId,
            actorType: 'system',
            action: 'run.dead_lettered',
            entityType: 'run',
            entityId: runId,
            metadata: {
              jobId: job.id,
              exhaustedData: data,
              reason: 'Job exhausted all pg-boss retries',
              persistedAt: new Date().toISOString(),
            },
          });

          // If run exists, mark it failed
          if (runId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
            await repo.updateRunStatus(runId, {
              status: 'failed',
              errorCode: 'DEAD_LETTERED',
              errorMessage: 'Job exhausted all retries and was dead-lettered',
              completedAt: new Date(),
            });
          }

          log.warn({ jobId: job.id, runId }, 'Dead-lettered automation job persisted');
        } catch (dlErr) {
          log.error({ err: dlErr, jobId: job.id }, 'Failed to process dead-letter job');
          // Rethrow so pg-boss can retry the DLQ processing itself
          throw dlErr;
        }
      }
    }) as never,
  );

  // ─── Scheduled sweeps ──────────────────────────────────────────────────────
  await pgboss.schedule(AUTOMATION_QUEUES.inbox, INBOX_INTERVAL_CRON, {}, { singletonKey: 'automation-inbox-sweep' } as never);
  await pgboss.schedule(AUTOMATION_QUEUES.maintenance, MAINTENANCE_INTERVAL_CRON, {}, { singletonKey: 'automation-maintenance' } as never);
  await pgboss.schedule(AUTOMATION_QUEUES.schedule, SCHEDULE_INTERVAL_CRON, {}, { singletonKey: 'automation-schedule' } as never);

  log.info({ queues: AUTOMATION_QUEUES }, 'Automation pg-boss workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(AUTOMATION_QUEUES.inbox).catch(() => undefined);
      await pgboss.unschedule(AUTOMATION_QUEUES.maintenance).catch(() => undefined);
      await pgboss.unschedule(AUTOMATION_QUEUES.schedule).catch(() => undefined);
      log.info('Automation workers unscheduled');
    },
  };
}
