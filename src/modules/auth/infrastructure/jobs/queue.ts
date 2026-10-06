/**
 * Auth automation PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgmq, type PgmqMessage } from '../../../../lib/pgmq.js';
import { PgmqWorker } from '../../../../lib/pgmq-worker.js';
import { runDailyAuthAutomation } from './cleanup.js';

export const AUTH_AUTOMATION_JOBS = {
  daily: 'auth_automation_daily',
} as const;

export interface AuthAutomationSchedule {
  dailyIntervalMs?: number;
}

const DEFAULT_SCHEDULE: Required<AuthAutomationSchedule> = {
  dailyIntervalMs: 86400_000,
};

export async function registerAuthAutomationWorkers(
  logger: FastifyBaseLogger,
  schedule: AuthAutomationSchedule = {},
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
  const log = logger.child({ component: 'auth-automation-workers' });

  await pgmq.createQueue(AUTH_AUTOMATION_JOBS.daily);

  const worker = new PgmqWorker(
    pgmq,
    async () => {
      await runDailyAuthAutomation(log);
    },
    { queue: AUTH_AUTOMATION_JOBS.daily, batchSize: 1, concurrency: 1 },
  );
  await worker.start();

  const timer = setInterval(() => {
    void pgmq.send(AUTH_AUTOMATION_JOBS.daily, {}).catch(() => {});
  }, cfg.dailyIntervalMs);
  timer.unref();

  log.info({ ...cfg }, 'Auth automation worker registered with PGMQ');

  return {
    stop: async () => {
      clearInterval(timer);
      await worker.stop();
    },
  };
}
