/**
 * Organization cleanup PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgmq, type PgmqMessage } from '../../../../lib/pgmq.js';
import { PgmqWorker } from '../../../../lib/pgmq-worker.js';
import { OrganizationRepository } from '../../repository.js';
import { runDailyOrgCleanup, runHourlyOrgCleanup } from './cleanup.js';

export const ORG_CLEANUP_JOBS = {
  hourly: 'org_cleanup_hourly',
  daily: 'org_cleanup_daily',
} as const;

export interface OrgCleanupSchedule {
  hourlyIntervalMs?: number;
  dailyIntervalMs?: number;
}

const DEFAULT_SCHEDULE: Required<OrgCleanupSchedule> = {
  hourlyIntervalMs: 3600_000,
  dailyIntervalMs: 86400_000,
};

export async function registerOrganizationCleanupWorkers(
  logger: FastifyBaseLogger,
  schedule: OrgCleanupSchedule = {},
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
  const log = logger.child({ component: 'org-cleanup-workers' });
  const repo = new OrganizationRepository();

  await Promise.all([
    pgmq.createQueue(ORG_CLEANUP_JOBS.hourly),
    pgmq.createQueue(ORG_CLEANUP_JOBS.daily),
  ]);

  const hourlyWorker = new PgmqWorker(
    pgmq,
    async () => {
      await runHourlyOrgCleanup(repo, log);
    },
    { queue: ORG_CLEANUP_JOBS.hourly, batchSize: 1, concurrency: 1 },
  );

  const dailyWorker = new PgmqWorker(
    pgmq,
    async () => {
      await runDailyOrgCleanup(repo, log);
    },
    { queue: ORG_CLEANUP_JOBS.daily, batchSize: 1, concurrency: 1 },
  );

  const workers: PgmqWorker[] = [hourlyWorker, dailyWorker];
  await Promise.all(workers.map((w) => w.start()));

  const timers = [
    setInterval(() => void pgmq.send(ORG_CLEANUP_JOBS.hourly, {}).catch(() => {}), cfg.hourlyIntervalMs),
    setInterval(() => void pgmq.send(ORG_CLEANUP_JOBS.daily, {}).catch(() => {}), cfg.dailyIntervalMs),
  ];
  for (const t of timers) t.unref();

  log.info({ ...cfg }, 'Organization cleanup PGMQ workers registered');

  return {
    stop: async () => {
      for (const t of timers) clearInterval(t);
      await Promise.all(workers.map((w) => w.stop()));
    },
  };
}
