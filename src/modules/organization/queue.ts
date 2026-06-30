/**
 * Organization cleanup pg-boss queue wiring (Postgres-backed cron — no Redis).
 *
 * Why pg-boss schedules instead of setInterval:
 *   - The API runs under PM2 cluster mode (one process per core); a setInterval
 *     there would fire N times. pg-boss schedules are stored in Postgres and a
 *     scheduled job is delivered to exactly ONE worker, so cleanup runs once
 *     regardless of how many worker/cron processes are live.
 *   - Mirrors how the alerting and event-analytics modules schedule their
 *     maintenance jobs (see modules/alerting/queue.ts).
 *
 * Registration runs in the WORKER process (src/workers/main.ts) by default, and
 * can alternatively run in a dedicated cron process (src/workers/cron.ts). Both
 * are safe to run simultaneously — pg-boss upserts the schedule by name and only
 * one consumer gets each fired job.
 *
 * Cron cadences (server timezone):
 *   - org.cleanup.hourly : top of every hour  — expire stale invitations,
 *                          revoke expired API keys / SCIM tokens.
 *   - org.cleanup.daily  : 03:30 daily         — purge terminal invitations,
 *                          drained email outbox, and audit logs past retention.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../lib/pgboss.js';
import { OrganizationRepository } from './repository.js';
import { runDailyOrgCleanup, runHourlyOrgCleanup } from './cleanup.js';

export const ORG_CLEANUP_JOBS = {
  hourly: 'org.cleanup.hourly',
  daily: 'org.cleanup.daily',
} as const;

export interface OrgCleanupSchedule {
  /** Cron for the hourly state-move pass. Default: top of every hour. */
  hourlyCron?: string;
  /** Cron for the daily purge pass. Default: 03:30 daily. */
  dailyCron?: string;
}

const DEFAULT_SCHEDULE: Required<OrgCleanupSchedule> = {
  hourlyCron: '0 * * * *',
  dailyCron: '30 3 * * *',
};

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

/**
 * Register the organization cleanup workers + cron schedules. Idempotent per
 * process. Returns a stop() that cancels the schedules (handlers drain via
 * pg-boss shutdown).
 */
export async function registerOrganizationCleanupWorkers(
  logger: FastifyBaseLogger,
  schedule: OrgCleanupSchedule = {},
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
  const log = logger.child({ component: 'org-cleanup-workers' });
  const repo = new OrganizationRepository();

  await safeCreateQueue(ORG_CLEANUP_JOBS.hourly);
  await safeCreateQueue(ORG_CLEANUP_JOBS.daily);

  // Handlers receive an array of jobs in pg-boss v12; we ignore the payload and
  // just run the sweep. retryLimit keeps a transient DB blip from skipping a run.
  await pgboss.work(
    ORG_CLEANUP_JOBS.hourly,
    {} as never,
    (async () => {
      await runHourlyOrgCleanup(repo, log);
    }) as never,
  );

  await pgboss.work(
    ORG_CLEANUP_JOBS.daily,
    {} as never,
    (async () => {
      await runDailyOrgCleanup(repo, log);
    }) as never,
  );

  await pgboss.schedule(ORG_CLEANUP_JOBS.hourly, cfg.hourlyCron, {}, {} as never);
  await pgboss.schedule(ORG_CLEANUP_JOBS.daily, cfg.dailyCron, {}, {} as never);

  log.info({ ...cfg }, 'Organization cleanup cron registered');

  return {
    stop: async () => {
      await pgboss.unschedule(ORG_CLEANUP_JOBS.hourly).catch(() => undefined);
      await pgboss.unschedule(ORG_CLEANUP_JOBS.daily).catch(() => undefined);
    },
  };
}
