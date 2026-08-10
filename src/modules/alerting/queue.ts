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
import { pgboss } from '../../lib/pgboss.js';
import { env } from '../../config/env.js';
import { pool } from '../../config/database.js';
import { AlertingRepository } from './repository.js';
import { AlertBatchProcessor, type BatchJobData } from './batch-processor.js';
import { AlertEscalationSweep } from './escalation.js';
import { ConnectorRepository } from '../connectors/repository.js';
import type { ProjectSubscriptionResolver } from './batch-processor.js';
import { AlertRuntimeEngines, type FastEvaluationInput } from './runtime/engines.js';
import { NotificationRoutingService } from './runtime/notification-routing.service.js';
import { AlertChannelRepository } from '../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from './config/alert-config.repository.js';
import { AlertNotificationRouter } from './runtime/notification-router.js';
import { TelemetryOutboxRelay } from './runtime/telemetry-outbox-relay.js';
import { AlertDecisionEngine, type AlertDecisionCandidate } from './decision/decision.engine.js';
import { SnapshotEscalationWorker } from './escalation/escalation.worker.js';
import { logDB } from '../../config/log-database.js';
import { AlertRuntimeRepository, type NotificationJobInsert } from './runtime/alert-runtime.repository.js';
import { hashCanonical } from './runtime/effective-rule-contract.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';

export const ALERT_JOBS = {
  formBatches: 'alert.form-batches',
  processBatch: 'alert.process-batch',
  escalationSweep: 'alert.escalation-sweep',
  autoResolve: 'alert.auto-resolve',
  orphanSweep: 'alert.orphan-sweep',
  cleanup: 'alert.cleanup',
  deadLetter: 'alert-dead-letter',
  deadLetterRetry: 'alert.dead-letter-retry',
  decide: 'alert.decide',
  escalate: 'alert.escalate',
  correlate: 'alert.correlate',
  digest: 'notification.digest',
  evaluateFast: 'alert.evaluate.fast',
  evaluateWindow: 'alert.evaluate.window',
  evaluateOperational: 'alert.evaluate.operational',
  evaluateAi: 'alert.evaluate.ai',
  notificationRouter: 'alert.notification-router',
  telemetryOutboxRelay: 'alert.telemetry-outbox-relay',
  errorGroupRegressed: 'alert.error-group-regressed',
} as const;

const BATCH_SIZE = 100;

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

const DEFAULTS: Required<AlertingWorkerConfig> = {
  teamSize: 5,
  teamConcurrency: 3,
  formIntervalSeconds: 30,
  autoResolveIntervalSeconds: 60,
  maxBatchesPerFormRun: 20,
  stuckThresholdMinutes: 15,
  sweepClaimLimit: 200,
  retentionResolvedEventsDays: 30,
  retentionBatchesDays: 14,
  retentionDeliveryAttemptsDays: 30,
  retentionDeadLettersDays: 30,
  deadLetterMaxRetries: 3,
};

/** Minimal shape we rely on from a pg-boss job (avoids version-specific types). */
interface MinimalJob<T> { id: string; data: T }

function firstJob<T>(arg: unknown): MinimalJob<T> | null {
  if (Array.isArray(arg)) return (arg[0] as MinimalJob<T>) ?? null;
  return (arg as MinimalJob<T>) ?? null;
}

function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
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
export async function registerAlertingWorkers(
  logger: FastifyBaseLogger,
  config: AlertingWorkerConfig = {},
  projectSubscriptionResolver?: ProjectSubscriptionResolver,
  telemetryPool?: Pool,
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULTS, ...config };
  const log = logger.child({ component: 'alerting-workers' });

  const alertRepo = new AlertingRepository();
  const connectorRepo = new ConnectorRepository();
  const enqueueConnectorJob = async (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) =>
    pgboss.send(queue, data, options as never);
  const runtimePoolForJobs = telemetryPool ?? logDB.getPrimaryPool();
  const runtimeRepositoryForJobs = new AlertRuntimeRepository(runtimePoolForJobs);
  const entitlement = new NotificationEntitlementService();
  const runtimePool = telemetryPool ?? pool;
  const routing = new NotificationRoutingService({
    logger,
    channelRepository: new AlertChannelRepository(pool),
    configRepository: new AlertConfigRepository(pool),
    entitlementService: entitlement,
  });
  const processor = new AlertBatchProcessor(
    alertRepo,
    connectorRepo,
    enqueueConnectorJob,
    logger,
    projectSubscriptionResolver,
    undefined,
    entitlement,
    routing,
    async (event, target, alertKey, payload) => {
      const job: NotificationJobInsert = {
        organizationId: event.organization_id,
        projectId: event.project_id,
        alertEventId: event.id,
        alertKey,
        ruleId: event.rule_id,
        channelKind: target.channelKind,
        connectorId: null,
        recipientUserId: target.recipientUserId,
        recipientRef: target.recipientRef,
        notificationType: 'alert',
        deliveryMode: target.deliveryMode,
        recipientType: target.recipientType,
        provider: target.provider,
        severity: event.severity as NotificationJobInsert['severity'],
        payload: payload as unknown as Record<string, unknown>,
        idempotencyKey: hashCanonical({
          alertEventId: event.id,
          projectId: event.project_id,
          ownerUserId: target.recipientUserId,
          ownerEmail: target.recipientRef,
          notificationType: 'alert',
          escalationStep: 0,
        }),
        routingDecisionHash: hashCanonical({ alertKey, target }),
        billable: true,
      };
      const inserted = await runtimeRepositoryForJobs.insertNotificationJobs([job]);
      const insertedJob = inserted[0];
      if (!insertedJob) return null;
      await pgboss.send(ALERT_JOBS.notificationRouter, { notificationJobId: insertedJob.id }, {
        retryLimit: 3,
        retryDelay: 1,
        retryBackoff: true,
        expireInSeconds: 300,
      } as never);
      return insertedJob.id;
    },
  );
  const escalationSweep = new AlertEscalationSweep(alertRepo, connectorRepo, enqueueConnectorJob, logger);
  // ── Queue creation with enterprise defaults ─────────────────────────────
  // process-batch: retries with backoff, then dead-letters to `alert-dead-letter`.
  await safeCreateQueue(ALERT_JOBS.formBatches);
  await safeCreateQueue(ALERT_JOBS.processBatch, {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 7200,
    deadLetter: ALERT_JOBS.deadLetter,
  });
  await safeCreateQueue(ALERT_JOBS.escalationSweep);
  await safeCreateQueue(ALERT_JOBS.autoResolve);
  await safeCreateQueue(ALERT_JOBS.orphanSweep);
  await safeCreateQueue(ALERT_JOBS.cleanup);
  await safeCreateQueue(ALERT_JOBS.deadLetter);
  await safeCreateQueue(ALERT_JOBS.deadLetterRetry);
  await safeCreateQueue(ALERT_JOBS.decide, {
    retryLimit: 5,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: 300,
  });
  await safeCreateQueue(ALERT_JOBS.escalate);
  await safeCreateQueue(ALERT_JOBS.correlate);
  await safeCreateQueue(ALERT_JOBS.digest);
  await safeCreateQueue(ALERT_JOBS.evaluateFast);
  await safeCreateQueue(ALERT_JOBS.evaluateWindow);
  await safeCreateQueue(ALERT_JOBS.evaluateOperational);
  await safeCreateQueue(ALERT_JOBS.evaluateAi);
  await safeCreateQueue(ALERT_JOBS.notificationRouter);
  await safeCreateQueue(ALERT_JOBS.telemetryOutboxRelay);
  await safeCreateQueue(ALERT_JOBS.errorGroupRegressed, {
    retryLimit: 3,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: 300,
  });

  const runtimeEngines = new AlertRuntimeEngines(logger, runtimePool, pool, routing);
  const notificationRouter = new AlertNotificationRouter(runtimePool, logger);
  const telemetryOutboxRelay = new TelemetryOutboxRelay(runtimePool, logger);
  const decisionEngine = new AlertDecisionEngine(runtimePool, logger, { routing });
  const snapshotEscalation = new SnapshotEscalationWorker(logger, runtimePool, routing);

  // ── process-batch: the high-throughput worker ──────────────────────────
  // pg-boss v12 concurrency options: `localConcurrency` = number of workers
  // polling/processing independently, `batchSize` = jobs fetched per poll.
  // The WorkHandler always receives an ARRAY of jobs in v12.
  await pgboss.work(
    ALERT_JOBS.processBatch,
    { localConcurrency: cfg.teamConcurrency, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<BatchJobData>(arg);
      // Each delivered job is independent; process concurrently (no sequential await loop).
      await Promise.all(jobs.map((job) => processor.processBatch(job.data)));
    }) as never,
  );

  // ── form-batches: claim pending → enqueue process-batch jobs ────────────
  await pgboss.work(
    ALERT_JOBS.formBatches,
    {} as never,
    (async (arg: unknown) => {
      const job = firstJob<{ organizationId?: string }>(arg);
      await formBatches(alertRepo, log, cfg.maxBatchesPerFormRun, job?.data?.organizationId);
    }) as never,
  );

  // ── escalation-sweep: advance due escalations + resume expired acks ─────
  await pgboss.work(
    ALERT_JOBS.escalationSweep,
    {} as never,
    (async () => {
      await escalationSweep.run(cfg.sweepClaimLimit);
    }) as never,
  );

  // ── auto-resolve: resolve stale firing alerts ──────────────────────────
  await pgboss.work(
    ALERT_JOBS.autoResolve,
    {} as never,
    (async () => {
      const stale = await alertRepo.claimAutoResolvable(cfg.sweepClaimLimit);
      // Resolve concurrently — no sequential async loop.
      await mapBounded(stale, 10, async (event) => {
        await alertRepo.resolveEvent(event.organization_id, event.id, null, 'auto_resolved', true);
        await alertRepo.insertHistory({
          eventId: event.id, organizationId: event.organization_id,
          action: 'auto_resolved', actorId: null, actorType: 'worker',
        });
      });
      if (stale.length > 0) log.info({ resolved: stale.length }, 'Auto-resolved stale alerts');
    }) as never,
  );

  // ── orphan-sweep: recover events/batches stuck in 'processing' ─────────
  // Covers worker crashes and job expiry: events return to 'pending' (the form
  // worker re-batches them) and stale batches are marked failed.
  await pgboss.work(
    ALERT_JOBS.orphanSweep,
    {} as never,
    (async () => {
      const requeued = await alertRepo.requeueStuckProcessingEvents(cfg.stuckThresholdMinutes, cfg.sweepClaimLimit);
      const failedBatches = await alertRepo.failStaleBatches(cfg.stuckThresholdMinutes);
      if (requeued.length > 0 || failedBatches > 0) {
        await mapBounded(requeued, 10, async (event) => {
          await alertRepo.insertHistory({
            eventId: event.id, organizationId: event.organization_id,
            action: 'requeued', actorId: null, actorType: 'worker',
            metadata: { reason: 'stuck_processing', stuckThresholdMinutes: cfg.stuckThresholdMinutes },
          });
        });
        log.warn({ requeued: requeued.length, failedBatches }, 'Orphan sweep recovered stuck alerts');
      }
    }) as never,
  );

  // ── dead-letter intake: persist exhausted process-batch jobs ────────────
  await pgboss.work(
    ALERT_JOBS.deadLetter,
    {} as never,
    (async (arg: unknown) => {
      const jobs = allJobs<BatchJobData>(arg);
      await Promise.allSettled(jobs.map(async (job) => {
        const { batchId, organizationId } = job.data;
        const loaded = await alertRepo.getBatchWithEvents(batchId, organizationId).catch(() => null);
        await alertRepo.insertDeadLetter({
          organizationId,
          sourceQueue: ALERT_JOBS.processBatch,
          pgBossJobId: job.id,
          batchId,
          eventIds: loaded ? loaded.events.map((e) => e.id) : [],
          jobPayload: job.data as unknown as Record<string, unknown>,
          errorMessage: 'process-batch job exhausted retries',
          maxRetries: cfg.deadLetterMaxRetries,
        });
        if (loaded) {
          await mapBounded(loaded.events, 10, async (event) => {
            await alertRepo.insertHistory({
              eventId: event.id, organizationId,
              action: 'dead_lettered', actorId: null, actorType: 'worker',
              metadata: { batchId, pgBossJobId: job.id },
            });
          });
        }
        log.error({ batchId, organizationId, jobId: job.id }, 'process-batch job dead-lettered');
      }));
    }) as never,
  );

  // ── dead-letter-retry: re-drive retryable dead letters ──────────────────
  // Only re-sends when the batch is still in 'processing' (not yet recovered
  // by the orphan sweeper); otherwise the automatic recovery already covers it.
  await pgboss.work(
    ALERT_JOBS.deadLetterRetry,
    {} as never,
    (async () => {
      const deadLetters = await alertRepo.claimRetryableDeadLetters(50);
      await mapBounded(deadLetters, 5, async (deadLetter) => {
        try {
          let redrove = false;
          if (deadLetter.batch_id) {
            const loaded = await alertRepo.getBatchWithEvents(deadLetter.batch_id, deadLetter.organization_id).catch(() => null);
            if (loaded && loaded.batch.status === 'processing') {
              await pgboss.send(
                ALERT_JOBS.processBatch,
                { batchId: deadLetter.batch_id, organizationId: deadLetter.organization_id } satisfies BatchJobData,
                { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 } as never,
              );
              redrove = true;
            }
          }
          if (redrove || deadLetter.retry_count + 1 < deadLetter.max_retries) {
            await alertRepo.markDeadLetterRetried(deadLetter.id);
          } else {
            await alertRepo.markDeadLetterExhausted(deadLetter.id);
          }
        } catch (err) {
          log.error({ err, deadLetterId: deadLetter.id }, 'Dead-letter re-drive failed');
        }
      });
      if (deadLetters.length > 0) log.info({ count: deadLetters.length }, 'Dead-letter retry sweep finished');
    }) as never,
  );

  // ── cleanup: retention purge ────────────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.cleanup,
    {} as never,
    (async () => {
      const [events, batches, attempts, deadLetters, throttles] = await Promise.all([
        alertRepo.purgeOldTerminalEvents(cfg.retentionResolvedEventsDays),
        alertRepo.purgeOldBatches(cfg.retentionBatchesDays),
        alertRepo.purgeOldDeliveryAttempts(cfg.retentionDeliveryAttemptsDays),
        alertRepo.purgeOldDeadLetters(cfg.retentionDeadLettersDays),
        alertRepo.purgeOldThrottleWindows(),
      ]);
      log.info(
        { events, batches, attempts, deadLetters, throttles },
        'Alerting retention cleanup finished',
      );
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.decide,
    { localConcurrency: 8, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<AlertDecisionCandidate>(arg);
      await Promise.all(jobs.map(async (job) => {
        const result = await decisionEngine.decide({
          ...job.data,
          observedAt: new Date(job.data.observedAt),
        });
        await Promise.all(result.notificationJobs.map((notificationJob) =>
          pgboss.send(ALERT_JOBS.notificationRouter, { notificationJobId: notificationJob.id }, {
            retryLimit: 3,
            retryDelay: 1,
            retryBackoff: true,
            expireInSeconds: 300,
          } as never),
        ));
      }));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.escalate,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      if (!env.ESCALATION_V2) return;
      const jobs = allJobs<Parameters<SnapshotEscalationWorker['run']>[0]>(arg);
      await Promise.all(jobs.map((job) => snapshotEscalation.run(job.data)));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.correlate,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async () => undefined) as never,
  );

  await pgboss.work(
    ALERT_JOBS.digest,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async () => undefined) as never,
  );

  await pgboss.work(
    ALERT_JOBS.evaluateFast,
    { localConcurrency: 8, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<FastEvaluationInput>(arg);
      await Promise.all(jobs.map((job) => runtimeEngines.evaluateFast(job.data)));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.evaluateWindow,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'window' }),
      ));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.evaluateOperational,
    { localConcurrency: 3, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'operational' }),
      ));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.evaluateAi,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'ai' }),
      ));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.notificationRouter,
    { localConcurrency: 5, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ notificationJobId?: string }>(arg);
      await Promise.all(jobs.map((job) =>
        job.data.notificationJobId
          ? notificationRouter.dispatchById(job.data.notificationJobId)
          : notificationRouter.run(100),
      ));
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.telemetryOutboxRelay,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async () => {
      await telemetryOutboxRelay.run(250);
    }) as never,
  );

  await pgboss.work(
    ALERT_JOBS.errorGroupRegressed,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<Record<string, unknown>>(arg);
      await Promise.all(jobs.map(async (job) => {
        const payload = job.data;
        await runtimeEngines.evaluateFast({
          organizationId: String(payload.organizationId ?? ''),
          projectId: String(payload.projectId ?? ''),
          environment: typeof payload.environment === 'string' ? payload.environment : null,
          events: [{
            type: 'error',
            eventId: String(payload.eventId ?? ''),
            message: String(payload.eventType ?? 'ErrorGroupRegressed'),
            severity: String(payload.severity ?? 'error'),
            fingerprint: String(payload.fingerprint ?? ''),
          }],
        } as never);
      }));
    }) as never,
  );

  // ── Schedules (cron) ────────────────────────────────────────────────────
  // pg-boss cron is minute-granularity; sub-minute cadence is approximated by
  // the form worker re-claiming whatever is pending each run.
  await pgboss.schedule(ALERT_JOBS.formBatches, '* * * * *', {}, { singletonKey: 'alert-form-batches' } as never);
  await pgboss.schedule(ALERT_JOBS.escalationSweep, '* * * * *', {}, { singletonKey: 'alert-escalation-sweep' } as never);
  await pgboss.schedule(ALERT_JOBS.autoResolve, '* * * * *', {}, { singletonKey: 'alert-auto-resolve' } as never);
  await pgboss.schedule(ALERT_JOBS.orphanSweep, '*/5 * * * *', {}, { singletonKey: 'alert-orphan-sweep' } as never);
  await pgboss.schedule(ALERT_JOBS.deadLetterRetry, '*/5 * * * *', {}, { singletonKey: 'alert-dead-letter-retry' } as never);
  await pgboss.schedule(ALERT_JOBS.cleanup, '17 3 * * *', {}, { singletonKey: 'alert-cleanup' } as never);
  if (env.ESCALATION_V2) {
    await pgboss.schedule(ALERT_JOBS.correlate, '*/1 * * * *', {}, { singletonKey: 'alert-correlate' } as never);
    await pgboss.schedule(ALERT_JOBS.digest, '*/1 * * * *', {}, { singletonKey: 'notification-digest' } as never);
  }
  const runtimeTimers = startRuntimeDispatchTimers(runtimePool, log);

  log.info({ ...cfg }, 'Alerting workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(ALERT_JOBS.formBatches).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.escalationSweep).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.autoResolve).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.orphanSweep).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.deadLetterRetry).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.cleanup).catch(() => undefined);
      for (const timer of runtimeTimers) clearInterval(timer);
    },
  };
}

function startRuntimeDispatchTimers(telemetryPool: Pool, log: FastifyBaseLogger): NodeJS.Timeout[] {
  const dispatch = async (
    queue: typeof ALERT_JOBS.evaluateWindow | typeof ALERT_JOBS.evaluateOperational | typeof ALERT_JOBS.evaluateAi,
    cadenceSeconds: number,
  ): Promise<void> => {
    try {
      const orgs = await activeRuntimeOrganizations(telemetryPool);
      const bucket = Math.floor(Date.now() / (cadenceSeconds * 1000));
      await Promise.allSettled(orgs.map((organizationId) =>
        pgboss.send(
          queue,
          { organizationId },
          {
            singletonKey: `${queue}:${organizationId}:${bucket}`,
            expireInSeconds: Math.max(60, cadenceSeconds * 4),
            retryLimit: 2,
            retryDelay: 5,
            retryBackoff: true,
          } as never,
        ),
      ));
      if (orgs.length > 0) log.debug({ queue, orgs: orgs.length }, 'Runtime alert evaluation jobs dispatched');
    } catch (err) {
      log.warn({ err, queue }, 'Runtime alert evaluation dispatch failed');
    }
  };

  const timers = [
    setInterval(() => void dispatch(ALERT_JOBS.evaluateWindow, 5), 5_000),
    setInterval(() => void dispatch(ALERT_JOBS.evaluateOperational, 30), 30_000),
    setInterval(() => void dispatch(ALERT_JOBS.evaluateAi, 300), 300_000),
    setInterval(() => void pgboss.send(ALERT_JOBS.notificationRouter, {}, {
      singletonKey: `alert-notification-router:${Math.floor(Date.now() / 10_000)}`,
      expireInSeconds: 60,
    } as never).catch(() => undefined), 10_000),
    setInterval(() => void pgboss.send(ALERT_JOBS.telemetryOutboxRelay, {}, {
      singletonKey: `alert-telemetry-outbox:${Math.floor(Date.now() / 1_000)}`,
      expireInSeconds: 30,
    } as never).catch(() => undefined), 1_000),
  ];
  for (const timer of timers) timer.unref();

  void dispatch(ALERT_JOBS.evaluateWindow, 5);
  void dispatch(ALERT_JOBS.evaluateOperational, 30);
  void dispatch(ALERT_JOBS.evaluateAi, 300);
  return timers;
}

async function activeRuntimeOrganizations(telemetryPool: Pool): Promise<string[]> {
  const result = await telemetryPool.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM (
         SELECT organization_id FROM events_requests WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_errors WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_logs WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_cron_checkins WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM ai_requests WHERE updated_at >= NOW() - INTERVAL '15 minutes'
       ) recent
      LIMIT 1000`,
  );
  return result.rows.map((row) => row.organization_id);
}

async function safeCreateQueue(name: string, options?: Record<string, unknown>): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string, o?: Record<string, unknown>) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name, options).catch(() => undefined);
  }
}

/**
 * Claim pending events (in batches of 100) for orgs that have any, and enqueue
 * a process-batch job per batch. Bounded by `maxBatches` per run to avoid
 * starving other queues. The pg-boss job id is recorded on the batch for
 * dead-letter traceability.
 */
async function formBatches(
  alertRepo: AlertingRepository,
  log: FastifyBaseLogger,
  maxBatches: number,
  onlyOrgId?: string,
): Promise<number> {
  const orgIds = onlyOrgId ? [onlyOrgId] : await alertRepo.findOrgsWithPendingEvents(maxBatches);
  if (orgIds.length === 0) return 0;

  let formed = 0;
  const perOrgCap = Math.max(1, Math.floor(maxBatches / orgIds.length)); // fair share
  await Promise.all(orgIds.map(async (orgId) => {
    const workerId = `former-${process.pid}`;
    for (let i = 0; i < perOrgCap; i++) {
      const batch = await alertRepo.createBatchFromPending(orgId, BATCH_SIZE, workerId);
      if (!batch) break; // org drained
      const jobId = await pgboss.send(ALERT_JOBS.processBatch,
        { batchId: batch.id, organizationId: orgId } satisfies BatchJobData,
        { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 } as never);
      await alertRepo.setBatchJobId(batch.id, typeof jobId === 'string' ? jobId : null);
      formed += 1;
    }
  }));

  if (formed > 0) log.info({ formed }, 'Formed and enqueued alert batches');
  return formed;
}

async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i]!;
      try { results[i] = { status: 'fulfilled', value: await fn(item) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
