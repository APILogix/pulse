/**
 * Ingestion module for Fastify.
 *
 * Flow:
 * 1. Open Redis for cache and BullMQ queue operations.
 * 2. Create the ingestion queue with retry/backoff and dead-letter retention.
 * 3. Create RedisCache and PostgresWriter infrastructure objects.
 * 4. Decorate Fastify so routes can compose the controller/service.
 * 5. Register ingestion routes under /api and close external connections during
 *    Fastify shutdown.
 */
import fp from 'fastify-plugin';
import { Queue } from 'bullmq';
import { Redis } from "ioredis";
import { Pool } from 'pg';
import { ingestionRoutes } from './routes.js';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';
export const ingestionModule = fp(async function (fastify) {
    // 1. Redis connection shared by RedisCache and BullMQ.
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    // 2. BullMQ queue with retry/backoff and failed-job retention for DLQ tooling.
    const ingestionQueue = new Queue('ingestion', {
        connection: redis,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { count: 5000, age: 3600 },
            removeOnFail: { count: 10000, age: 86400 * 7 },
        }
    });
    // 3. Cache layer for API-key/project lookup, rate limiting, idempotency, and
    // ingestion counters.
    const redisCache = new RedisCache(redis);
    // 4. Database writer pool dedicated to ingestion lookups and worker writes.
    const pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: 'ingestion_api',
    });
    // Verify DB connection during boot so the API fails fast if persistence is
    // unavailable.
    await pgPool.query('SELECT 1');
    const postgresWriter = new PostgresWriter(pgPool);
    // 5. Decorate Fastify with concrete dependencies consumed by routes.ts.
    fastify.decorate('ingestionQueue', ingestionQueue);
    fastify.decorate('redisCache', redisCache);
    fastify.decorate('postgresWriter', postgresWriter);
    // 6. Register HTTP routes under /api.
    await fastify.register(ingestionRoutes, { prefix: '/api' });
    // 7. Graceful shutdown closes queue, Redis, and database pool in order.
    fastify.addHook('onClose', async () => {
        fastify.log.info('Closing ingestion module...');
        await ingestionQueue.close();
        await redis.quit();
        await pgPool.end();
    });
});
//# sourceMappingURL=ingestion.module.js.map