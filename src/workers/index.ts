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
import type { RedisCache } from '../db/redis/cache.js';

export interface WorkerDependencies {
  writer: PostgresWriter;
  cache: RedisCache;
  shutdown?: () => Promise<void>;
}

export function initializeWorkers(redis: Redis, deps: WorkerDependencies) {
  // Ingestion Worker (primary)
  const ingestionWorker = createIngestionWorker(redis, deps.writer, deps.cache);

  // Future: Additional specialized workers can be registered here
  // const analysisWorker = createAnalysisWorker(...);
  // const billingWorker = createBillingWorker(...);

  const gracefulShutdown = async (signal: string) => {
    console.log(`[Workers] Received ${signal}, shutting down...`);
    await ingestionWorker.close();
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
