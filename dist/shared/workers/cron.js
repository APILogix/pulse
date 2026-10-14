/**
 * Dedicated cron process (PostgreSQL-backed scheduling via Supabase PGMQ).
 */
import { env } from '../../config/env.js';
import { closeDatabase } from '../../config/database.js';
import { logProcessConnectionBudget } from '../../config/connection-budget.js';
import { logger } from '../../config/logger.js';
import { pgmq } from '../../lib/pgmq.js';
import { registerAuthAutomationWorkers } from '../../modules/auth/infrastructure/jobs/queue.js';
import { registerBillingJobWorkers } from '../../modules/billing/queue.js';
import { registerOrganizationCleanupWorkers } from '../../modules/organization/shared/background/queue.js';
const cronLogger = logger.child({ component: 'cron' });
async function bootstrapCron() {
    logProcessConnectionBudget('cron', cronLogger);
    if (!env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set');
    }
    await pgmq.ensureKnownQueuesLoaded();
    const [authAutomation, billingJobs, orgCleanup] = await Promise.all([
        registerAuthAutomationWorkers(cronLogger),
        registerBillingJobWorkers(cronLogger),
        registerOrganizationCleanupWorkers(cronLogger),
    ]);
    cronLogger.info('Cron process started with Supabase PGMQ - auth automation, billing, and organization cleanup active');
    const shutdown = async (signal) => {
        cronLogger.info({ signal }, 'Shutdown signal received - stopping cron');
        try {
            await authAutomation.stop();
            await billingJobs.stop();
            await orgCleanup.stop();
            await Promise.allSettled([pgmq.close(), closeDatabase()]);
        }
        catch (err) {
            cronLogger.error({ err }, 'Error during cron shutdown');
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
}
bootstrapCron().catch(async (error) => {
    cronLogger.fatal({ error }, 'Failed to start cron process');
    await Promise.allSettled([pgmq.close(), closeDatabase()]).then((results) => {
        const closeError = results.find((result) => result.status === 'rejected');
        if (closeError)
            cronLogger.error({ err: closeError.reason }, 'Failed to close cron resources');
    });
    process.exit(1);
});
//# sourceMappingURL=cron.js.map