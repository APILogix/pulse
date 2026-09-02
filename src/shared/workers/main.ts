/**
 * Worker process bootstrap (PostgreSQL queue - no BullMQ/Redis).
 *
 * Flow:
 * 1. Open a dedicated Postgres pool for background work.
 * 2. Start pg-boss background workers (alerting, billing, connectors, auth,
 *    analytics, org cleanup) plus the telemetry maintenance worker.
 * 3. Keep the process alive until SIGTERM/SIGINT, then drain + close cleanly.
 *
 * NOTE: ingestion persistence runs in the DEDICATED ingestion worker process
 * (src/shared/workers/ingestion-worker-main.ts), not here.
 *
 * Scale horizontally by running multiple copies of this process. SKIP LOCKED
 * makes that safe.
 */
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { logDB } from '../../config/log-database.js';
import { isExpectedServerlessDisconnect, resolvePostgresSslConfig } from '../../config/postgres-ssl.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { registerAuthAutomationWorkers } from '../../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingJobWorkers } from '../../modules/billing/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
import { registerAnalyticsWorkers } from '../../modules/event-analytics/queue.js';
import { registerOrganizationCleanupWorkers } from '../../modules/organization/shared/background/queue.js';
import { registerUserDataExportWorker } from '../../modules/user-account/queue.js';
import { registerAIWorkers } from '../../modules/ai/queue.js';
import { registerAutomationWorkers } from '../../modules/automation/workers.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { AlertRuntimeRepository } from '../../modules/alerting/runtime/alert-runtime.repository.js';
import { AlertConfigRepository } from '../../modules/alerting/config/alert-config.repository.js';
import { startAuthCleanupWorker, stopAuthCleanupWorker } from './auth-cleanup.processor.js';
import { startAuthEmailWorker, stopAuthEmailWorker } from './auth-email.processor.js';
import { startOrgEmailWorker, stopOrgEmailWorker } from './org-email.processor.js';
import { TelemetryMaintenanceWorker } from './telemetry-maintenance.processor.js';
const workerLogger = logger.child({ component: 'workers' });

async function bootstrapWorkers(): Promise<void> {
  const pgPool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: resolvePostgresSslConfig(env.DATABASE_URL, {
      enabled: env.DB_SSL_ENABLED,
      rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    }),
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    application_name: `pulse_background_workers_${env.NODE_ENV}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
  });

  pgPool.on('connect', (client) => {
    client.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        workerLogger.debug({ err: err.message }, 'Client background worker connection closed (Neon/PgBouncer)');
        return;
      }
      workerLogger.debug({ err: err.message }, 'PostgreSQL client socket error on active/checked-out background worker connection');
    });
  });

  pgPool.on('error', (err: Error) => {
    if (isExpectedServerlessDisconnect(err)) {
      workerLogger.debug({ err: err.message }, 'Idle worker pool connection closed by server (Neon/PgBouncer)');
      return;
    }
    workerLogger.error({ err }, 'Unexpected worker pool error');
  });

  await pgPool.query('SELECT 1');
  await logDB.connect();

  // ── ADR-0006 pool ownership assertion ──────────────────────────────────────
  // docs/alerting-redesign/adr/0006-database-ownership.md
  //
  // Prove BEFORE any worker starts that each alerting pool is attached to the
  // database that owns its tables. Audit finding B1: the evaluator read telemetry
  // through the control-plane pool while ingestion wrote it through the Log DB pool,
  // so whenever LOG_DB_PRIMARY was a genuinely separate database, telemetry-driven
  // alerts silently never fired. This turns that into a startup crash.
  //
  // Deployment prerequisite (07-migration-plan.md §7 step 1 before step 2): the Log DB
  // alerting migrations must be applied first. Set ALERTING_RUNTIME_POOL_ASSERT=false
  // only for local bootstrap.
  await new AlertRuntimeRepository(logDB.getPrimaryPool()).assertRuntimePool(workerLogger);
  await new AlertConfigRepository().assertConfigPool(workerLogger);

  const maintenance = new TelemetryMaintenanceWorker(pgPool, workerLogger);
  maintenance.start();

  let alertingWorkers: { stop: () => Promise<void> } | null = null;
  let analyticsWorkers: { stop: () => Promise<void> } | null = null;
  let authAutomationWorkers: { stop: () => Promise<void> } | null = null;
  let billingJobWorkers: { stop: () => Promise<void> } | null = null;
  let connectorMonitor: { stop: () => Promise<void> } | null = null;
  let orgCleanupWorkers: { stop: () => Promise<void> } | null = null;
  let userDataExportWorker: { stop: () => Promise<void> } | null = null;
  let aiWorkers: { stop: () => Promise<void> } | null = null;
  let automationWorkers: { stop: () => Promise<void> } | null = null;

  // Ingestion persistence moved to the dedicated ingestion worker process
  // (src/shared/workers/ingestion-worker-main.ts — pg-boss per-type queues).
  // This process no longer polls the legacy ingestion_jobs table; the legacy
  // PgQueue wiring in ./index.ts is retained on disk only for reference.
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    workerLogger.info({ signal }, 'Shutdown signal received — draining workers');
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
    if (userDataExportWorker) await userDataExportWorker.stop();
    if (aiWorkers) await aiWorkers.stop();
    if (automationWorkers) await automationWorkers.stop();
    await stopPgBoss();
    await logDB.close();
    await pgPool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  await startPgBoss();
  await startAuthEmailWorker();
  await startOrgEmailWorker();

  authAutomationWorkers = await registerAuthAutomationWorkers(workerLogger);
  billingJobWorkers = await registerBillingJobWorkers(workerLogger);
  connectorMonitor = await startConnectorMonitor(workerLogger);
  // ADR-0006 / DEV-002: the evaluators must read `events_*` through the pool that ingestion
  // writes them with. Injected here so the alerting module never imports the Log DB singleton.
  alertingWorkers = await registerAlertingWorkers(
    workerLogger,
    {},
    undefined,
    logDB.getPrimaryPool(),
  );
  analyticsWorkers = await registerAnalyticsWorkers(workerLogger);
  userDataExportWorker = await registerUserDataExportWorker(workerLogger);
  aiWorkers = await registerAIWorkers(workerLogger);
  automationWorkers = await registerAutomationWorkers(workerLogger);

  if (process.env.ORG_CRON_ENABLED !== 'false') {
    orgCleanupWorkers = await registerOrganizationCleanupWorkers(workerLogger);
  } else {
    workerLogger.info('Organization cleanup cron disabled in worker (ORG_CRON_ENABLED=false)');
  }

  startAuthCleanupWorker();

  // PM2's wait_ready gate keeps the worker out of the healthy process set
  // until every queue consumer and scheduled job has registered successfully.
  process.send?.('ready');
  workerLogger.info('Worker process started');
  workerLogger.info('Active workers: telemetry-maintenance, auth-cleanup, auth-email, auth-automation-cron (pg-boss), org-email, org-cleanup-cron (pg-boss), connectors (pg-boss), alerting (pg-boss), billing (pg-boss), event-analytics (pg-boss), user-data-export (pg-boss), ai-reliability-analysis (pg-boss), automation (pg-boss)');
}

bootstrapWorkers().catch((error) => {
  workerLogger.fatal({ error }, 'Failed to start worker process');
  process.exit(1);
});
