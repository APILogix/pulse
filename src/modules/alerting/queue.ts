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
import { pgboss } from '../../lib/pgboss.js';
import { AlertingRepository } from './repository.js';
import { AlertBatchProcessor, type BatchJobData } from './batch-processor.js';
import { AlertEscalationSweep } from './escalation.js';
import { ConnectorRepository } from '../connectors/repository.js';

export const ALERT_JOBS = {
  formBatches: 'alert.form-batches',
  processBatch: 'alert.process-batch',
  escalationSweep: 'alert.escalation-sweep',
  autoResolve: 'alert.auto-resolve',
  orphanSweep: 'alert.orphan-sweep',
  cleanup: 'alert.cleanup',
  deadLetter: 'alert-dead-letter',
  deadLetterRetry: 'alert.dead-letter-retry',
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
export async function registerAlertingWorkers(
  logger: FastifyBaseLogger,
  config: AlertingWorkerConfig = {},
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULTS, ...config };
  const log = logger.child({ component: 'alerting-workers' });

  const alertRepo = new AlertingRepository();
  const connectorRepo = new ConnectorRepository();
  const enqueueConnectorJob = async (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) =>
    pgboss.send(queue, data, options as never);
  const processor = new AlertBatchProcessor(alertRepo, connectorRepo, enqueueConnectorJob, logger);
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

  // ── Schedules (cron) ────────────────────────────────────────────────────
  // pg-boss cron is minute-granularity; sub-minute cadence is approximated by
  // the form worker re-claiming whatever is pending each run.
  await pgboss.schedule(ALERT_JOBS.formBatches, '* * * * *', {}, { singletonKey: 'alert-form-batches' } as never);
  await pgboss.schedule(ALERT_JOBS.escalationSweep, '* * * * *', {}, { singletonKey: 'alert-escalation-sweep' } as never);
  await pgboss.schedule(ALERT_JOBS.autoResolve, '* * * * *', {}, { singletonKey: 'alert-auto-resolve' } as never);
  await pgboss.schedule(ALERT_JOBS.orphanSweep, '*/5 * * * *', {}, { singletonKey: 'alert-orphan-sweep' } as never);
  await pgboss.schedule(ALERT_JOBS.deadLetterRetry, '*/5 * * * *', {}, { singletonKey: 'alert-dead-letter-retry' } as never);
  await pgboss.schedule(ALERT_JOBS.cleanup, '17 3 * * *', {}, { singletonKey: 'alert-cleanup' } as never);

  log.info({ ...cfg }, 'Alerting workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(ALERT_JOBS.formBatches).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.escalationSweep).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.autoResolve).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.orphanSweep).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.deadLetterRetry).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.cleanup).catch(() => undefined);
    },
  };
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
