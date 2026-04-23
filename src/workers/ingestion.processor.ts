import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import { RedisCache } from '../db/redis/cache.js';
import type { EnrichedEvent } from '../modules/ingestion/types.js';

export function createIngestionWorker(
  connection: Redis,
  writer: PostgresWriter,
  cache: RedisCache
): Worker {
  const worker = new Worker(
    'ingestion',
    async (job: Job<EnrichedEvent>) => {
      const event = job.data;

      // Skip if circuit is open
      if (await cache.isCircuitOpen('database')) {
        throw new Error('CIRCUIT_OPEN');
      }

      try {
        switch (event.type) {
          case 'request': {
            await writer.writeRequestEvents([event]);
            break;
          }
          case 'error': {
            await writer.writeErrorEvents([event]);
            break;
          }
          case 'log':
          case 'metric':
          case 'custom': {
            await writer.writeEvents([event]);
            break;
          }
          default: {
            await writer.writeEvents([event]);
          }
        }

        // Record success (close circuit if recovering)
        await cache.recordSuccess('database');
      } catch (err) {
        // Record failure for circuit breaker
        await cache.recordFailure('database', 10);
        throw err; // Let BullMQ handle retry/DLQ
      }
    },
    {
      connection,
      concurrency: 20, // Tune based on DB connection pool
      limiter: {
        max: 100,
        duration: 1000, // 100 jobs/sec max
      },
      stalledInterval: 30000,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed (${job.data.type})`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
    // Alerting integration here (PagerDuty, Slack, etc.)
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[Worker] Job ${jobId} stalled`);
  });

  return worker;
}