/**
 * Worker process bootstrap (PostgreSQL queue — no BullMQ/Redis).
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
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { initializeWorkers } from './index.js';
import { TelemetryMaintenanceWorker } from './telemetry-maintenance.processor.js';
import { startAuthCleanupWorker, stopAuthCleanupWorker } from './auth-cleanup.processor.js';
import { startPgBoss, stopPgBoss } from '../lib/pgboss.js';
import { startAuthEmailWorker, stopAuthEmailWorker } from './auth-email.processor.js';
import { registerAlertingWorkers } from '../modules/alerting/queue.js';
import { registerAnalyticsWorkers } from '../modules/event-analytics/queue.js';
import { startConnectorMonitor } from '../modules/connectors/workers.js';

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
  let connectorMonitor: { stop: () => Promise<void> } | null = null;

  initializeWorkers({
    pool: pgPool,
    concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY ?? 4),
    shutdown: async () => {
      maintenance.stop();
      stopAuthCleanupWorker();
      stopAuthEmailWorker();
      if (alertingWorkers) await alertingWorkers.stop();
      if (analyticsWorkers) await analyticsWorkers.stop();
      if (connectorMonitor) await connectorMonitor.stop();
      await stopPgBoss();
      await pgPool.end();
    },
  });

  // Start PgBoss and the Auth Email Worker
  await startPgBoss();
  await startAuthEmailWorker();

  // Connector delivery retry + health sweeps (moved out of the API process).
  connectorMonitor = startConnectorMonitor(workerLogger);

  // Alerting pg-boss workers: batch processing (teamSize 5 / teamConcurrency 5),
  // batch formation, and auto-resolve sweeps.
  alertingWorkers = await registerAlertingWorkers(workerLogger);

  // Event-analytics pg-boss workers: hourly rollups, error grouping, partition maintenance.
  analyticsWorkers = await registerAnalyticsWorkers(workerLogger);

  // Auth housekeeping (expired sessions, stale email tokens). Runs hourly.
  startAuthCleanupWorker();

  workerLogger.info('Worker process started');
  workerLogger.info('Active workers: ingestion (pg-queue), telemetry-maintenance, auth-cleanup, connectors-monitor, alerting (pg-boss), event-analytics (pg-boss)');
}

bootstrapWorkers().catch((error) => {
  workerLogger.fatal({ error }, 'Failed to start worker process');
  process.exit(1);
});
