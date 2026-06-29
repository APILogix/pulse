/**
 * Event-analytics pg-boss workers.
 *
 * Jobs (registered in the WORKER process — see workers/main.ts):
 *   - analytics.rollup-hourly      — refresh hourly rollups per org
 *   - analytics.error-grouping     — upsert analytics_error_groups per org
 *   - analytics.partition-maintain — create upcoming daily partitions
 *
 * Scheduled "fan-out" jobs enumerate orgs with recent data and enqueue the
 * per-org work. pg-boss v12 option names are used (localConcurrency/batchSize/
 * expireInSeconds); the WorkHandler receives an ARRAY of jobs.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../lib/pgboss.js';
import { pool } from '../../config/database.js';
import { EventAnalyticsRepository } from './repository.js';

export const ANALYTICS_JOBS = {
  rollupHourly: 'analytics.rollup-hourly',
  errorGrouping: 'analytics.error-grouping',
  partitionMaintain: 'analytics.partition-maintain',
} as const;

interface MinimalJob<T> { id: string; data: T }
function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
}

export async function registerAnalyticsWorkers(
  logger: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'event-analytics-workers' });
  const repo = new EventAnalyticsRepository(pool);

  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  for (const name of Object.values(ANALYTICS_JOBS)) {
    if (typeof boss.createQueue === 'function') await boss.createQueue(name).catch(() => undefined);
  }

  // Per-org hourly rollup (refresh the trailing 2 hours to catch late events).
  await pgboss.work(
    ANALYTICS_JOBS.rollupHourly,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ orgId: string }>(arg);
      await Promise.allSettled(jobs.map(async (job) => {
        const end = new Date();
        const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
        await repo.refreshHourlyRollup(job.data.orgId, start, end);
      }));
    }) as never,
  );

  // Per-org error grouping.
  await pgboss.work(
    ANALYTICS_JOBS.errorGrouping,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ orgId: string }>(arg);
      await Promise.allSettled(jobs.map((job) => repo.refreshErrorGroups(job.data.orgId, 24)));
    }) as never,
  );

  // Partition maintenance — keep a week of daily partitions ahead.
  await pgboss.work(
    ANALYTICS_JOBS.partitionMaintain,
    {} as never,
    (async () => {
      await pool.query('SELECT create_event_partitions(7)');
      log.info('Daily partitions ensured');
    }) as never,
  );

  // ── Fan-out via cron-ish scheduling ──────────────────────────────────────
  // Every 5 minutes: enqueue hourly rollup + error grouping for orgs with
  // recent errors. Partition maintenance runs daily.
  await pgboss.schedule(ANALYTICS_JOBS.partitionMaintain, '0 0 * * *', {}, {} as never);

  // pg-boss schedule is per-queue; we use a lightweight self-managed interval
  // to fan out per-org jobs (kept in the worker process, unref'd).
  const fanOut = async (): Promise<void> => {
    try {
      const orgs = await repo.listOrgsWithRecentErrors(2);
      await Promise.allSettled(orgs.flatMap((orgId) => [
        pgboss.send(ANALYTICS_JOBS.rollupHourly, { orgId }, { expireInSeconds: 600 } as never),
        pgboss.send(ANALYTICS_JOBS.errorGrouping, { orgId }, { expireInSeconds: 600 } as never),
      ]));
      if (orgs.length > 0) log.debug({ orgs: orgs.length }, 'Enqueued analytics rollups');
    } catch (err) {
      log.warn({ err }, 'Analytics fan-out failed');
    }
  };
  const timer = setInterval(() => void fanOut(), 5 * 60 * 1000);
  timer.unref();
  void fanOut(); // prime immediately

  log.info('Event-analytics workers registered');

  return {
    stop: async () => {
      clearInterval(timer);
      await pgboss.unschedule(ANALYTICS_JOBS.partitionMaintain).catch(() => undefined);
    },
  };
}
