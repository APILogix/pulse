/**
 * Worker registry and lifecycle wiring.
 *
 * Flow:
 * 1. Receive already-constructed infrastructure dependencies from a bootstrap
 *    entrypoint.
 * 2. Create the ingestion worker, which is the only active worker today.
 * 3. Keep future worker registration centralized here so one process can own
 *    multiple BullMQ workers.
 * 4. Handle SIGTERM/SIGINT by closing workers first, then optional external
 *    infrastructure such as Redis and Postgres.
 */
import { Redis } from 'ioredis';
import { createIngestionWorker } from './ingestion.processor.js';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import { logger } from '../config/logger.js';
import { startBillingWorker, stopBillingWorker } from './billing.processor.js';
import { BillingRepository } from '../modules/billing/repository.js';
const workerLogger = logger.child({ component: 'worker-registry' });
export function initializeWorkers(redis, deps) {
    // Ingestion Worker (primary)
    const ingestionWorker = createIngestionWorker(redis, deps.writer, deps.cache, deps.billingRepository);
    // Future: Additional specialized workers can be registered here
    // const analysisWorker = createAnalysisWorker(...);
    startBillingWorker(deps.pgPool);
    const gracefulShutdown = async (signal) => {
        workerLogger.info({ signal }, 'Shutdown signal received');
        await ingestionWorker.close();
        stopBillingWorker();
        if (deps.shutdown) {
            await deps.shutdown();
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    return {
        ingestionWorker,
    };
}
//# sourceMappingURL=index.js.map