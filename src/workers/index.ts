import { Redis } from 'ioredis';
import { createIngestionWorker } from './ingestion.processor.js';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import type { RedisCache } from '../db/redis/cache.js';

export interface WorkerDependencies {
  writer: PostgresWriter;
  cache: RedisCache;
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
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return {
    ingestionWorker,
  };
}