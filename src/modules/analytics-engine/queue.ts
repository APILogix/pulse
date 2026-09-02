/**
 * Analytics engine queue registration (pg-boss).
 *
 * Spec: docs/analytics/06-worker-architecture.md §1 and §4
 *
 * pg-boss is used purely as job transport on the control-plane database; all
 * analytics DATA lives in the Log DB. Job payloads are tiny and idempotent, so a
 * duplicated delivery recomputes the same bucket to the same value.
 *
 * This module is imported ONLY by src/shared/workers/analytics-worker-main.ts.
 * It is never imported by the ingestion worker or the API process.
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pgboss } from '../../lib/pgboss.js';
import { env } from '../../config/env.js';
import { ALERT_JOBS } from '../alerting/queue-names.js';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { buildAnalyticsWorkers, resolveAnalyticsConfig } from './registry.js';
import { runCompaction } from './workers/compaction.worker.js';
import { ensurePartitions, runRetention } from './workers/maintenance.worker.js';
import { TIER_INTERVAL_MS, type AnalyticsJobData, type AnalyticsWorkerSpec } from './types.js';

export const ANALYTICS_PLATFORM_JOBS = {
  compact5m: 'analytics.compaction.5m',
  compact1h: 'analytics.compaction.1h',
  compact1d: 'analytics.compaction.1d',
  retention: 'analytics.retention',
  partitions: 'analytics.partitions',
} as const;

const ALERT_EVALUATION_JOBS = [
  ALERT_JOBS.evaluateWindow,
  ALERT_JOBS.evaluateOperational,
  ALERT_JOBS.evaluateAi,
] as const;

interface MinimalJob<T> {
  id: string;
  data: T;
}

/** pg-boss v12 hands the handler an ARRAY of jobs. */
function allJobs<T>(argument: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(argument)) return argument as Array<MinimalJob<T>>;
  return argument ? [argument as MinimalJob<T>] : [];
}

async function ensureQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (queue: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

export interface AnalyticsEngineRuntime {
  workers: AnalyticsWorkerSpec[];
  watermarks: AnalyticsWatermarkRepository;
  stop: () => Promise<void>;
}

/**
 * Registers every analytics worker plus the platform jobs.
 *
 * Fan-out: a self-managed interval per tier enqueues one job per (worker, org)
 * with a singleton key, so duplicate dispatches collapse instead of piling up.
 * pg-boss `schedule` is per-queue and cannot express per-org fan-out, which is
 * why the dispatcher is an interval rather than a cron entry.
 */
export async function registerAnalyticsEngineWorkers(
  pool: Pool,
  logger: Logger,
): Promise<AnalyticsEngineRuntime> {
  const log = logger.child({ component: 'analytics-engine-queue' });
  const config = resolveAnalyticsConfig();
  const { workers, watermarks } = buildAnalyticsWorkers(pool);

  for (const worker of workers) await ensureQueue(worker.queue);
  for (const queue of Object.values(ANALYTICS_PLATFORM_JOBS)) await ensureQueue(queue);
  for (const queue of ALERT_EVALUATION_JOBS) await ensureQueue(queue);

  // ── Domain workers ───────────────────────────────────────────────────────
  for (const worker of workers) {
    await pgboss.work(
      worker.queue,
      {
        localConcurrency: Math.min(worker.concurrency, env.ANALYTICS_WORKER_CONCURRENCY),
        batchSize: 1,
      } as never,
      (async (argument: unknown) => {
        const jobs = allJobs<AnalyticsJobData>(argument);
        for (const job of jobs) {
          const startedAt = Date.now();
          try {
            const result = await worker.run(
              { pool, logger: log, now: new Date(), config },
              job.data,
            );
            await watermarks.recordRun({
              workerId: worker.id,
              organizationId: job.data.orgId,
              windowSize: worker.windowSize,
              windowStart: new Date(job.data.windowStart),
              windowEnd: new Date(job.data.windowEnd),
              rowsRead: result.rowsRead,
              rowsWritten: result.rowsWritten,
              durationMs: Date.now() - startedAt,
              outcome: result.outcome,
              ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
            });
            if (result.rowsWritten > 0) {
              await enqueueAlertEvaluationForAnalyticsWorker(worker.id, job.data.orgId, log);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failures = await watermarks.recordFailure(
              worker.id,
              job.data.orgId,
              worker.windowSize,
              message,
            );
            await watermarks.recordRun({
              workerId: worker.id,
              organizationId: job.data.orgId,
              windowSize: worker.windowSize,
              windowStart: new Date(job.data.windowStart),
              windowEnd: new Date(job.data.windowEnd),
              rowsRead: 0,
              rowsWritten: 0,
              durationMs: Date.now() - startedAt,
              outcome: 'failed',
              errorMessage: message,
            });
            log.error(
              { err: error, worker: worker.id, orgId: job.data.orgId, consecutiveFailures: failures },
              'Analytics worker run failed; watermark not advanced',
            );
            // Rethrow so pg-boss applies the retry policy.
            throw error;
          }
        }
      }) as never,
    );
  }

  // ── Platform jobs ────────────────────────────────────────────────────────
  await pgboss.work(ANALYTICS_PLATFORM_JOBS.compact5m, {} as never, (async () => {
    await runCompaction(pool, log, '5m');
  }) as never);

  await pgboss.work(ANALYTICS_PLATFORM_JOBS.compact1h, {} as never, (async () => {
    await runCompaction(pool, log, '1h');
  }) as never);

  await pgboss.work(ANALYTICS_PLATFORM_JOBS.compact1d, {} as never, (async () => {
    await runCompaction(pool, log, '1d');
  }) as never);

  await pgboss.work(ANALYTICS_PLATFORM_JOBS.retention, {} as never, (async () => {
    if (!config.retentionEnabled) {
      log.info('Analytics retention disabled by ANALYTICS_RETENTION_ENABLED=false');
      return;
    }
    await runRetention(pool, log);
  }) as never);

  await pgboss.work(ANALYTICS_PLATFORM_JOBS.partitions, {} as never, (async () => {
    await ensurePartitions(pool, log, 7);
  }) as never);

  await pgboss.schedule(ANALYTICS_PLATFORM_JOBS.compact5m, '* * * * *', {}, {} as never);
  await pgboss.schedule(ANALYTICS_PLATFORM_JOBS.compact1h, '*/5 * * * *', {}, {} as never);
  await pgboss.schedule(ANALYTICS_PLATFORM_JOBS.compact1d, '*/15 * * * *', {}, {} as never);
  await pgboss.schedule(ANALYTICS_PLATFORM_JOBS.retention, '17 * * * *', {}, {} as never);
  await pgboss.schedule(ANALYTICS_PLATFORM_JOBS.partitions, '0 1 * * *', {}, {} as never);

  // ── Dispatcher ───────────────────────────────────────────────────────────
  /**
   * Active organizations = those the engine already tracks, plus any org that
   * produced telemetry recently. The probe is bounded by the tenant/ingest index
   * added in 04_analytics/004.
   */
  const activeOrganizations = async (): Promise<string[]> => {
    const [tracked, recent] = await Promise.all([
      watermarks.trackedOrganizations(),
      pool
        .query<{ organization_id: string }>(
          `SELECT DISTINCT organization_id
             FROM events_requests
            WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
            LIMIT 1000`,
        )
        .then((result) => result.rows.map((row) => row.organization_id))
        .catch((error: unknown) => {
          log.warn({ err: error }, 'Analytics dispatcher could not probe recent organizations');
          return [] as string[];
        }),
    ]);
    return [...new Set([...tracked, ...recent])];
  };

  const dispatchTier = async (tier: 'live' | 'standard' | 'slow'): Promise<void> => {
    try {
      const orgs = await activeOrganizations();
      if (orgs.length === 0) return;

      const now = new Date();
      const windowStart = new Date(now.getTime() - TIER_INTERVAL_MS[tier]);
      const tierWorkers = workers.filter((worker) => worker.tier === tier);

      await Promise.allSettled(
        tierWorkers.flatMap((worker) =>
          orgs.map((orgId) =>
            pgboss.send(
              worker.queue,
              {
                orgId,
                windowStart: windowStart.toISOString(),
                windowEnd: now.toISOString(),
              } satisfies AnalyticsJobData,
              {
                expireInSeconds: Math.max(60, Math.floor(TIER_INTERVAL_MS[tier] / 1_000) * 4),
                retryLimit: worker.retryLimit,
                retryDelay: worker.retryBackoffSeconds,
                retryBackoff: true,
                singletonKey: `${worker.id}:${orgId}:${Math.floor(now.getTime() / TIER_INTERVAL_MS[tier])}`,
              } as never,
            ),
          ),
        ),
      );

      log.debug({ tier, orgs: orgs.length, workers: tierWorkers.length }, 'Analytics jobs dispatched');
    } catch (error) {
      log.warn({ err: error, tier }, 'Analytics dispatch failed');
    }
  };

  const timers: NodeJS.Timeout[] = [];
  for (const tier of ['live', 'standard', 'slow'] as const) {
    const timer = setInterval(() => void dispatchTier(tier), TIER_INTERVAL_MS[tier]);
    timer.unref();
    timers.push(timer);
    void dispatchTier(tier);
  }

  log.info(
    { workers: workers.map((worker) => worker.id), platformJobs: Object.values(ANALYTICS_PLATFORM_JOBS) },
    'Analytics engine workers registered',
  );

  return {
    workers,
    watermarks,
    stop: async () => {
      for (const timer of timers) clearInterval(timer);
      for (const queue of Object.values(ANALYTICS_PLATFORM_JOBS)) {
        await pgboss.unschedule(queue).catch(() => undefined);
      }
    },
  };
}

async function enqueueAlertEvaluationForAnalyticsWorker(
  workerId: string,
  organizationId: string,
  log: Logger,
): Promise<void> {
  const queues = alertQueuesForAnalyticsWorker(workerId);
  if (queues.length === 0) return;
  await Promise.all(queues.map(async (queue) => {
    const bucketSeconds = queue === ALERT_JOBS.evaluateWindow
      ? 5
      : queue === ALERT_JOBS.evaluateOperational ? 30 : 300;
    try {
      await pgboss.send(
        queue,
        { organizationId, sourceWorkerId: workerId },
        {
          singletonKey: `${queue}:${workerId}:${organizationId}:${Math.floor(Date.now() / (bucketSeconds * 1000))}`,
          expireInSeconds: Math.max(60, bucketSeconds * 4),
          retryLimit: 2,
          retryDelay: 5,
          retryBackoff: true,
        } as never,
      );
    } catch (err) {
      log.warn({ err, workerId, organizationId, queue }, 'Alert evaluation enqueue from analytics worker failed');
    }
  }));
}

function alertQueuesForAnalyticsWorker(workerId: string): string[] {
  if (
    workerId === 'analytics.requests'
    || workerId === 'analytics.errors'
    || workerId === 'analytics.crons'
  ) {
    return [ALERT_JOBS.evaluateWindow];
  }
  if (
    workerId === 'analytics.metrics'
    || workerId === 'analytics.runtime'
    || workerId === 'analytics.logs'
    || workerId === 'analytics.services'
    || workerId === 'analytics.endpoints'
  ) {
    return [ALERT_JOBS.evaluateOperational];
  }
  if (workerId === 'analytics.ai') return [ALERT_JOBS.evaluateWindow, ALERT_JOBS.evaluateAi];
  if (workerId === 'analytics.releases') {
    return [ALERT_JOBS.evaluateAi];
  }
  return [];
}
