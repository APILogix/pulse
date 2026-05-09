/**
 * Ingestion module for Fastify.
 *
 * Flow:
 * 1. Open a dedicated Redis connection for BullMQ (requires maxRetriesPerRequest: null).
 * 2. Create the ingestion queue with retry/backoff and dead-letter retention.
 * 3. Create RedisCache and PostgresWriter infrastructure objects.
 * 4. Decorate Fastify so routes can compose the controller/service.
 * 5. Register ingestion routes under /api and close external connections during
 *    Fastify shutdown.
 *
 * NOTE: This module uses its own Redis connection (not the shared one from
 * config/redis.ts) because BullMQ requires maxRetriesPerRequest: null which is
 * incompatible with normal Redis usage patterns.
 *
 * NOTE: This module reuses the shared Postgres pool from config/database.ts
 * instead of creating a duplicate pool. This prevents connection exhaustion
 * from having two pools (40 connections) hitting the same database.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { ingestionRoutes } from './routes.js';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';

const ingestionLogger = logger.child({ component: 'ingestion-module' });

// Extend Fastify instance for type safety
declare module 'fastify' {
  interface FastifyInstance {
    ingestionQueue: Queue;
    redisCache: RedisCache;
    postgresWriter: PostgresWriter;
  }
}

export const ingestionModule = fp(
  async function ingestionPlugin(fastify: FastifyInstance) {
    // 1. Dedicated Redis for BullMQ — needs maxRetriesPerRequest: null which
    //    breaks normal Redis usage, so this is intentionally separate.
    const ingestionRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times: number) => {
        if (times > 10) {
          ingestionLogger.fatal({ attempts: times }, 'Ingestion Redis retry limit exceeded');
          return null;
        }
        return Math.min(times * 50, 2000);
      },
    });

    ingestionRedis.on('error', (err) => {
      ingestionLogger.error({ err }, 'Ingestion Redis connection error');
    });

    // 2. BullMQ queue with retry/backoff and failed-job retention for DLQ tooling.
    const ingestionQueue = new Queue('ingestion', {
      connection: ingestionRedis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 5000, age: 3600 },
        removeOnFail: { count: 10000, age: 86400 * 7 },
      },
    });

    // 3. Cache layer using the dedicated ingestion Redis for API-key/project
    //    lookup, rate limiting, idempotency, and ingestion counters.
    const redisCache = new RedisCache(ingestionRedis);

    // 4. Reuse the shared Postgres pool from config/database.ts.
    //    Previously this module created its own Pool — that caused 2 pools
    //    (40 connections total) competing for the same database.
    const postgresWriter = new PostgresWriter(pool);

    // 5. Decorate Fastify with concrete dependencies consumed by routes.ts.
    fastify.decorate('ingestionQueue', ingestionQueue);
    fastify.decorate('redisCache', redisCache);
    fastify.decorate('postgresWriter', postgresWriter);

    // 6. Register HTTP routes under /api.
    await fastify.register(ingestionRoutes, { prefix: '/api' });

    ingestionLogger.info('Ingestion module registered');

    // 7. Graceful shutdown closes queue and the dedicated Redis.
    //    The shared Postgres pool is closed by main.ts shutdown handler.
    fastify.addHook('onClose', async () => {
      ingestionLogger.info('Closing ingestion module');
      await ingestionQueue.close();
      await ingestionRedis.quit();
      ingestionLogger.info('Ingestion module closed');
    });
  },
  {
    name: 'ingestion-module',
  },
);
