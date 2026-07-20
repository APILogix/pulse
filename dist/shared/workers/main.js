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
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { registerAuthAutomationWorkers } from '../../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingJobWorkers } from '../../modules/billing/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
import { registerAnalyticsWorkers } from '../../modules/event-analytics/queue.js';
import { registerOrganizationCleanupWorkers } from '../../modules/organization/shared/background/queue.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { ConnectorSubscriptionRepository } from '../../modules/projects/alerts/subscriptions/connector-subscription.repository.js';
import { startAuthCleanupWorker, stopAuthCleanupWorker } from './auth-cleanup.processor.js';
import { startAuthEmailWorker, stopAuthEmailWorker } from './auth-email.processor.js';
import { startOrgEmailWorker, stopOrgEmailWorker } from './org-email.processor.js';
import { TelemetryMaintenanceWorker } from './telemetry-maintenance.processor.js';
const workerLogger = logger.child({ component: 'workers' });
async function bootstrapWorkers() {
    const pgPool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 30000,
        application_name: 'ingestion_workers',
        keepAlive: true,
    });
    pgPool.on('error', (err) => {
        workerLogger.error({ err }, 'Unexpected worker pool error (idle connection lost)');
    });
    await pgPool.query('SELECT 1');
    const maintenance = new TelemetryMaintenanceWorker(pgPool, workerLogger);
    maintenance.start();
    let alertingWorkers = null;
    let analyticsWorkers = null;
    let authAutomationWorkers = null;
    let billingJobWorkers = null;
    let connectorMonitor = null;
    let orgCleanupWorkers = null;
    // Ingestion persistence moved to the dedicated ingestion worker process
    // (src/shared/workers/ingestion-worker-main.ts — pg-boss per-type queues).
    // This process no longer polls the legacy ingestion_jobs table; the legacy
    // PgQueue wiring in ./index.ts is retained on disk only for reference.
    let shuttingDown = false;
    const gracefulShutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        workerLogger.info({ signal }, 'Shutdown signal received — draining workers');
        maintenance.stop();
        stopAuthCleanupWorker();
        stopAuthEmailWorker();
        stopOrgEmailWorker();
        if (authAutomationWorkers)
            await authAutomationWorkers.stop();
        if (billingJobWorkers)
            await billingJobWorkers.stop();
        if (alertingWorkers)
            await alertingWorkers.stop();
        if (analyticsWorkers)
            await analyticsWorkers.stop();
        if (connectorMonitor)
            await connectorMonitor.stop();
        if (orgCleanupWorkers)
            await orgCleanupWorkers.stop();
        await stopPgBoss();
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
    const connectorSubRepo = new ConnectorSubscriptionRepository();
    const projectSubscriptionResolver = {
        resolveByProjectId: (projectId) => connectorSubRepo.resolveAlertRoutingTargetByProjectId(projectId),
    };
    alertingWorkers = await registerAlertingWorkers(workerLogger, {}, projectSubscriptionResolver);
    analyticsWorkers = await registerAnalyticsWorkers(workerLogger);
    if (process.env.ORG_CRON_ENABLED !== 'false') {
        orgCleanupWorkers = await registerOrganizationCleanupWorkers(workerLogger);
    }
    else {
        workerLogger.info('Organization cleanup cron disabled in worker (ORG_CRON_ENABLED=false)');
    }
    startAuthCleanupWorker();
    workerLogger.info('Worker process started');
    workerLogger.info('Active workers: telemetry-maintenance, auth-cleanup, auth-email, auth-automation-cron (pg-boss), org-email, org-cleanup-cron (pg-boss), connectors (pg-boss), alerting (pg-boss), billing (pg-boss), event-analytics (pg-boss)');
}
bootstrapWorkers().catch((error) => {
    workerLogger.fatal({ error }, 'Failed to start worker process');
    process.exit(1);
});
//# sourceMappingURL=main.js.map