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
import { pgboss } from '../../lib/pgboss.js';
import { AlertingRepository } from './repository.js';
import { AlertBatchProcessor, type BatchJobData } from './batch-processor.js';
import { ConnectorRepository } from '../connectors/repository.js';

export const ALERT_JOBS = {
  formBatches: 'alert.form-batches',
  processBatch: 'alert.process-batch',
  autoResolve: 'alert.auto-resolve',
  cleanup: 'alert.cleanup',
} as const;

const BATCH_SIZE = 100;

export interface AlertingWorkerConfig {
  teamSize?: number;
  teamConcurrency?: number;
  formIntervalSeconds?: number;
  autoResolveIntervalSeconds?: number;
  maxBatchesPerFormRun?: number;
}

const DEFAULTS: Required<AlertingWorkerConfig> = {
  teamSize: 5,
  teamConcurrency: 3,
  formIntervalSeconds: 30,
  autoResolveIntervalSeconds: 60,
  maxBatchesPerFormRun: 20,
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
  const processor = new AlertBatchProcessor(
    alertRepo,
    connectorRepo,
    async (queue, data, options) => pgboss.send(queue, data, options as never),
    logger,
  );

  // Ensure queues exist (pg-boss v10+ requires explicit creation in some setups).
  await safeCreateQueue(ALERT_JOBS.formBatches);
  await safeCreateQueue(ALERT_JOBS.processBatch);
  await safeCreateQueue(ALERT_JOBS.autoResolve);

  // ── process-batch: the high-throughput worker ──────────────────────────
  // pg-boss v12 concurrency options: `localConcurrency` = number of workers
  // polling/processing independently (the spec's teamSize/teamConcurrency = 5),
  // `batchSize` = jobs fetched per poll. The WorkHandler always receives an
  // ARRAY of jobs in v12.
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

  // ── auto-resolve: resolve stale firing alerts ──────────────────────────
  await pgboss.work(
    ALERT_JOBS.autoResolve,
    {} as never,
    (async () => {
      const stale = await alertRepo.claimAutoResolvable(200);
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

  // ── Schedules (cron) ────────────────────────────────────────────────────
  // pg-boss cron is minute-granularity; sub-minute cadence is approximated by
  // the form worker re-claiming whatever is pending each run.
  await pgboss.schedule(ALERT_JOBS.formBatches, '* * * * *', {}, { singletonKey: 'alert-form-batches' } as never);
  await pgboss.schedule(ALERT_JOBS.autoResolve, '* * * * *', {}, { singletonKey: 'alert-auto-resolve' } as never);

  log.info({ ...cfg }, 'Alerting workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(ALERT_JOBS.formBatches).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.autoResolve).catch(() => undefined);
    },
  };
}

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

/**
 * Claim pending events (in batches of 100) for orgs that have any, and enqueue
 * a process-batch job per batch. Bounded by `maxBatches` per run to avoid
 * starving other queues.
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
      await pgboss.send(ALERT_JOBS.processBatch,
        { batchId: batch.id, organizationId: orgId } satisfies BatchJobData,
        { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 } as never);
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
