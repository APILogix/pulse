/**
 * Auth automation pg-boss queue wiring.
 *
 * Runs scheduled Postgres-backed housekeeping for auth-owned durable
 * automation tables. This remains Redis-free and safe across multiple worker
 * or standalone cron processes because pg-boss delivers each scheduled job to
 * exactly one consumer.
 */
import type { FastifyBaseLogger } from 'fastify';

import { pgboss } from '../../../lib/pgboss.js';
import { runDailyAuthAutomation } from './cleanup.js';

export const AUTH_AUTOMATION_JOBS = {
  daily: 'auth.automation.daily',
} as const;

export interface AuthAutomationSchedule {
  /** Cron for the daily auth purge pass. Default: 02:15 daily. */
  dailyCron?: string;
}

const DEFAULT_SCHEDULE: Required<AuthAutomationSchedule> = {
  dailyCron: '15 2 * * *',
};

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

export async function registerAuthAutomationWorkers(
  logger: FastifyBaseLogger,
  schedule: AuthAutomationSchedule = {},
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
  const log = logger.child({ component: 'auth-automation-workers' });

  await safeCreateQueue(AUTH_AUTOMATION_JOBS.daily);

  await pgboss.work(
    AUTH_AUTOMATION_JOBS.daily,
    {} as never,
    (async () => {
      await runDailyAuthAutomation(log);
    }) as never,
  );

  await pgboss.schedule(
    AUTH_AUTOMATION_JOBS.daily,
    cfg.dailyCron,
    {},
    {} as never,
  );

  log.info({ ...cfg }, 'Auth automation cron registered');

  return {
    stop: async () => {
      await pgboss.unschedule(AUTH_AUTOMATION_JOBS.daily).catch(() => undefined);
    },
  };
}
