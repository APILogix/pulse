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

const workerLogger = logger.child({ component: 'workers' });

async function bootstrapWorkers(): Promise<void> {
  const pgPool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'ingestion_workers',
  });

  await pgPool.query('SELECT 1');

  const maintenance = new TelemetryMaintenanceWorker(pgPool, workerLogger);
  maintenance.start();

  initializeWorkers({
    pool: pgPool,
    concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY ?? 4),
    shutdown: async () => {
      maintenance.stop();
      stopAuthCleanupWorker();
      await pgPool.end();
    },
  });

  // Auth housekeeping (expired sessions, stale email tokens). Runs hourly.
  startAuthCleanupWorker();

  workerLogger.info('Worker process started');
  workerLogger.info('Active workers: ingestion (pg-queue), telemetry-maintenance, auth-cleanup');
}

bootstrapWorkers().catch((error) => {
  workerLogger.fatal({ error }, 'Failed to start worker process');
  process.exit(1);
});
