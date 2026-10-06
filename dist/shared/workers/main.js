/**
 * Worker process bootstrap (Supabase PostgreSQL pgmq - no BullMQ/Redis/pg-boss).
 *
 * Flow:
 * 1. Open a dedicated Postgres pool for background work.
 * 2. Start Supabase PGMQ background workers (alerting, billing, connectors, auth,
 *    analytics, org cleanup) plus the telemetry maintenance worker.
 * 3. Keep the process alive until SIGTERM/SIGINT, then drain + close cleanly.
 *
 * Scale horizontally by running multiple copies of this process. Visibility timeout
 * makes that safe.
 */
import '../../config/dns.js';
import { env } from '../../config/env.js';
import { closeDatabase, pool as pgPool } from '../../config/database.js';
import { logProcessConnectionBudget } from '../../config/connection-budget.js';
import { logger } from '../../config/logger.js';
import { logDB } from '../../config/log-database.js';
import { retryConfiguredStartupOperation } from '../../config/startup-retry.js';
import { pgmq } from '../../lib/pgmq.js';
import { registerAlertingWorkers } from '../../modules/alerting/queue.js';
import { registerAuthAutomationWorkers } from '../../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingJobWorkers } from '../../modules/billing/queue.js';
import { startConnectorMonitor } from '../../modules/connectors/workers.js';
import { registerAnalyticsWorkers } from '../../modules/event-analytics/queue.js';
import { registerOrganizationCleanupWorkers } from '../../modules/organization/shared/background/queue.js';
import { registerUserDataExportWorker } from '../../modules/user-account/queue.js';
import { registerAIWorkers } from '../../modules/ai/queue.js';
import { registerAutomationWorkers } from '../../modules/automation/workers.js';
import { AlertRuntimeRepository } from '../../modules/alerting/runtime/alert-runtime.repository.js';
import { AlertConfigRepository } from '../../modules/alerting/config/alert-config.repository.js';
import { startAuthCleanupWorker, stopAuthCleanupWorker } from './auth-cleanup.processor.js';
import { startAuthEmailWorker, stopAuthEmailWorker } from './auth-email.processor.js';
import { startOrgEmailWorker, stopOrgEmailWorker } from './org-email.processor.js';
import { TelemetryMaintenanceWorker } from './telemetry-maintenance.processor.js';
const workerLogger = logger.child({ component: 'workers' });
async function bootstrapWorkers() {
    logProcessConnectionBudget('worker', workerLogger);
    await retryConfiguredStartupOperation('background worker primary database', () => pgPool.query('SELECT 1'), workerLogger);
    await retryConfiguredStartupOperation('background worker log database', () => logDB.connect(), workerLogger);
    await new AlertRuntimeRepository(logDB.getPrimaryPool()).assertRuntimePool(workerLogger);
    await new AlertConfigRepository().assertConfigPool(workerLogger);
    const maintenance = new TelemetryMaintenanceWorker(logDB.getPrimaryPool(), workerLogger);
    let alertingWorkers = null;
    let analyticsWorkers = null;
    let authAutomationWorkers = null;
    let billingJobWorkers = null;
    let connectorMonitor = null;
    let orgCleanupWorkers = null;
    let userDataExportWorker = null;
    let aiWorkers = null;
    let automationWorkers = null;
    let shuttingDown = false;
    const gracefulShutdown = async (signal, initialCode = 0) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        let exitCode = initialCode;
        workerLogger.info({ signal }, 'Shutdown signal received — draining workers');
        const deadline = setTimeout(() => {
            workerLogger.fatal({ signal }, 'Worker shutdown timeout exceeded — forcing exit');
            process.exit(exitCode || 1);
        }, env.SHUTDOWN_TIMEOUT_MS);
        deadline.unref();
        try {
            maintenance.stop();
            stopAuthCleanupWorker();
            stopAuthEmailWorker();
            stopOrgEmailWorker();
            const workerStops = [
                authAutomationWorkers?.stop(),
                billingJobWorkers?.stop(),
                alertingWorkers?.stop(),
                analyticsWorkers?.stop(),
                connectorMonitor?.stop(),
                orgCleanupWorkers?.stop(),
                userDataExportWorker?.stop(),
                aiWorkers?.stop(),
                automationWorkers?.stop(),
            ].filter((operation) => operation !== undefined);
            const stopResults = await Promise.allSettled(workerStops);
            if (stopResults.some((result) => result.status === 'rejected'))
                exitCode = exitCode || 1;
            const closeResults = await Promise.allSettled([
                pgmq.close(),
                logDB.close(),
                closeDatabase(),
            ]);
            if (closeResults.some((result) => result.status === 'rejected'))
                exitCode = exitCode || 1;
        }
        catch (error) {
            exitCode = exitCode || 1;
            workerLogger.error({ err: error }, 'Unexpected worker shutdown failure');
        }
        finally {
            clearTimeout(deadline);
            process.exit(exitCode);
        }
    };
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
    // Pre-load all existing queue metadata once so subsequent worker calls complete in 0ms
    await pgmq.ensureKnownQueuesLoaded();
    // Register all worker modules concurrently in parallel
    const [authAuto, billing, connector, alerting, analytics, userDataExport, ai, automation, orgCleanup,] = await Promise.all([
        registerAuthAutomationWorkers(workerLogger),
        registerBillingJobWorkers(workerLogger),
        startConnectorMonitor(workerLogger),
        registerAlertingWorkers(workerLogger, {}, undefined, logDB.getPrimaryPool()),
        registerAnalyticsWorkers(workerLogger),
        registerUserDataExportWorker(workerLogger),
        registerAIWorkers(workerLogger),
        registerAutomationWorkers(workerLogger),
        process.env.ORG_CRON_ENABLED !== 'false'
            ? registerOrganizationCleanupWorkers(workerLogger)
            : Promise.resolve(null),
    ]);
    authAutomationWorkers = authAuto;
    billingJobWorkers = billing;
    connectorMonitor = connector;
    alertingWorkers = alerting;
    analyticsWorkers = analytics;
    userDataExportWorker = userDataExport;
    aiWorkers = ai;
    automationWorkers = automation;
    orgCleanupWorkers = orgCleanup;
    if (process.env.ORG_CRON_ENABLED === 'false') {
        workerLogger.info('Organization cleanup cron disabled in worker (ORG_CRON_ENABLED=false)');
    }
    // Lifecycle Stage: APPLICATION_READY & BACKGROUND_POLLERS_STARTED
    // Start background outbox pollers and maintenance only after all queues and workers are initialized
    maintenance.start();
    await startAuthEmailWorker();
    await startOrgEmailWorker();
    startAuthCleanupWorker();
    process.send?.('ready');
    workerLogger.info('Worker process started with Supabase PGMQ');
    workerLogger.info('Active workers: telemetry-maintenance, auth-cleanup, auth-email, auth-automation, org-email, org-cleanup, connectors, alerting, billing, event-analytics, user-data-export, ai-reliability-analysis, automation');
}
bootstrapWorkers().catch(async (error) => {
    workerLogger.fatal({ error }, 'Failed to start worker process');
    const results = await Promise.allSettled([
        pgmq.close(),
        logDB.close(),
        closeDatabase(),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
        workerLogger.error('One or more worker resources failed to close after startup failure');
    }
    process.exit(1);
});
//# sourceMappingURL=main.js.map