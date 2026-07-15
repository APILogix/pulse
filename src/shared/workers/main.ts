/**
 * Worker process bootstrap (PostgreSQL queue - no BullMQ/Redis).
 *
 * Flow:
 * 1. Open a dedicated Postgres pool for background work.
 * 2. Start N PgQueueWorkers (ingestion persistence) via initializeWorkers().
 * 3. Start the telemetry maintenance worker (partition automation + retention).
 * 4. Start auth housekeeping (expired sessions / stale tokens).
 * 5. Keep the process alive until SIGTERM/SIGINT, then drain + close cleanly.
 *
 * Scale horizontally by running multiple copies of this process. SKIP LOCKED
 * makes that safe.
 */
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { registerAuthAutomationWorkers } from '../../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingJobWorkers } from '../../modules/billing/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
import { registerAnalyticsWorkers } from '../../modules/event-analytics/queue.js';
import { registerOrganizationCleanupWorkers } from '../../modules/organization/shared/background/queue.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { startAuthCleanupWorker, stopAuthCleanupWorker } from './auth-cleanup.processor.js';
import { startAuthEmailWorker, stopAuthEmailWorker } from './auth-email.processor.js';
import { initializeWorkers } from './index.js';
import { startOrgEmailWorker, stopOrgEmailWorker } from './org-email.processor.js';
import { TelemetryMaintenanceWorker } from './telemetry-maintenance.processor.js';

const workerLogger = logger.child({ component: 'workers' });

async function bootstrapWorkers(): Promise<void> {
  const pgPool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
    application_name: 'ingestion_workers',
    keepAlive: true,
  });

  pgPool.on('error', (err: Error) => {
    workerLogger.error({ err }, 'Unexpected worker pool error (idle connection lost)');
  });

  await pgPool.query('SELECT 1');

  const maintenance = new TelemetryMaintenanceWorker(pgPool, workerLogger);
  maintenance.start();

  let alertingWorkers: { stop: () => Promise<void> } | null = null;
  let analyticsWorkers: { stop: () => Promise<void> } | null = null;
  let authAutomationWorkers: { stop: () => Promise<void> } | null = null;
  let billingJobWorkers: { stop: () => Promise<void> } | null = null;
  let connectorMonitor: { stop: () => Promise<void> } | null = null;
  let orgCleanupWorkers: { stop: () => Promise<void> } | null = null;

  initializeWorkers({
    pool: pgPool,
    concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY ?? 4),
    shutdown: async () => {
      maintenance.stop();
      stopAuthCleanupWorker();
      stopAuthEmailWorker();
      stopOrgEmailWorker();
      if (authAutomationWorkers) await authAutomationWorkers.stop();
      if (billingJobWorkers) await billingJobWorkers.stop();
      if (alertingWorkers) await alertingWorkers.stop();
      if (analyticsWorkers) await analyticsWorkers.stop();
      if (connectorMonitor) await connectorMonitor.stop();
      if (orgCleanupWorkers) await orgCleanupWorkers.stop();
      await stopPgBoss();
      await pgPool.end();
    },
  });

  await startPgBoss();
  await startAuthEmailWorker();
  await startOrgEmailWorker();

  authAutomationWorkers = await registerAuthAutomationWorkers(workerLogger);
  billingJobWorkers = await registerBillingJobWorkers(workerLogger);
  connectorMonitor = await startConnectorMonitor(workerLogger);
  alertingWorkers = await registerAlertingWorkers(workerLogger);
  analyticsWorkers = await registerAnalyticsWorkers(workerLogger);

  if (process.env.ORG_CRON_ENABLED !== 'false') {
    orgCleanupWorkers = await registerOrganizationCleanupWorkers(workerLogger);
  } else {
    workerLogger.info('Organization cleanup cron disabled in worker (ORG_CRON_ENABLED=false)');
  }

  startAuthCleanupWorker();

  workerLogger.info('Worker process started');
  workerLogger.info('Active workers: ingestion (pg-queue), telemetry-maintenance, auth-cleanup, auth-email, auth-automation-cron (pg-boss), org-email, org-cleanup-cron (pg-boss), connectors (pg-boss), alerting (pg-boss), billing (pg-boss), event-analytics (pg-boss)');
}

bootstrapWorkers().catch((error) => {
  workerLogger.fatal({ error }, 'Failed to start worker process');
  process.exit(1);
});
