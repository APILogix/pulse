/**
 * Dedicated cron process (PostgreSQL-backed scheduling via pg-boss - no Redis).
 *
 * This is the optional standalone scheduler. By default the organization
 * cleanup cron runs inside the main worker process (src/workers/main.ts). For
 * deployments that prefer to isolate scheduled maintenance in its own
 * container/pod, run this process instead and start the worker with
 * ORG_CRON_ENABLED=false so the schedule is owned in exactly one place.
 *
 * Run:
 *   npm run start:cron     (compiled)
 *   npm run dev:cron       (tsx watch)
 *
 * Single-execution guarantee: pg-boss delivers each scheduled job to exactly
 * one consumer, so even if this process and the worker both registered the
 * schedule, a job would still run once.
 */
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { startPgBoss, stopPgBoss } from '../lib/pgboss.js';
import { registerAuthAutomationWorkers } from '../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingWorkers } from '../modules/billing/queue.js';
import { registerOrganizationCleanupWorkers } from '../modules/organization/shared/background/queue.js';

const cronLogger = logger.child({ component: 'cron' });

async function bootstrapCron(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  await startPgBoss();

  const authAutomation = await registerAuthAutomationWorkers(cronLogger);
  const billing = await registerBillingWorkers(cronLogger);
  const orgCleanup = await registerOrganizationCleanupWorkers(cronLogger);

  cronLogger.info('Cron process started - auth automation, billing, and organization cleanup schedules active');

  const shutdown = async (signal: string): Promise<void> => {
    cronLogger.info({ signal }, 'Shutdown signal received - stopping cron');
    try {
      await authAutomation.stop();
      await billing.stop();
      await orgCleanup.stop();
      await stopPgBoss();
    } catch (err) {
      cronLogger.error({ err }, 'Error during cron shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrapCron().catch((error) => {
  cronLogger.fatal({ error }, 'Failed to start cron process');
  process.exit(1);
});
