import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import Redis from "ioredis";
import { Pool } from 'pg';
import { ingestionRoutes } from './routes.js';
import { RedisCache } from '../../db/redis/cache.js';

import { PostgresWriter } from './postgress.writter.js';
// Extend Fastify instance for type safety
declare module 'fastify' {
  interface FastifyInstance {
    ingestionQueue: Queue;
    redisCache: RedisCache;
    postgresWriter: PostgresWriter;
  }
}

export const ingestionModule = fp(async function (fastify: FastifyInstance) {
  // 1. Redis Connection
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  });

  // 2. BullMQ Queue
  const ingestionQueue = new Queue('ingestion', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 5000, age: 3600 },
      removeOnFail: { count: 10000, age: 86400 * 7 },
    }
  });

  // 3. Cache Layer
  const redisCache = new RedisCache(redis);

  // 4. Database Writer
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'ingestion_api',
  });

  // Verify DB connection
  await pgPool.query('SELECT 1');

  const postgresWriter = new PostgresWriter(pgPool);

  // 5. Decorate Fastify
  fastify.decorate('ingestionQueue', ingestionQueue);
  fastify.decorate('redisCache', redisCache);
  fastify.decorate('postgresWriter', postgresWriter);

  // 6. Register Routes
  await fastify.register(ingestionRoutes, { prefix: '/api' });

  // 7. Graceful Shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing ingestion module...');
    await ingestionQueue.close();
    await redis.quit();
    await pgPool.end();
  });
});