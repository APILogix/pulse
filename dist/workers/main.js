/**
 * Worker process bootstrap.
 *
 * Flow:
 * 1. Open Redis and Postgres connections dedicated to background work.
 * 2. Construct shared worker dependencies.
 * 3. Register all enabled BullMQ workers through `initializeWorkers()`.
 * 4. Keep the process alive until it receives a termination signal, then close
 *    workers and infrastructure cleanly.
 */
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { RedisCache } from '../db/redis/cache.js';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import { initializeWorkers } from './index.js';
const workerLogger = logger.child({ component: 'workers' });
async function bootstrapWorkers() {
    const redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    const pgPool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: 'ingestion_workers',
    });
    await redis.ping();
    await pgPool.query('SELECT 1');
    const cache = new RedisCache(redis);
    const writer = new PostgresWriter(pgPool);
    initializeWorkers(redis, {
        writer,
        cache,
        shutdown: async () => {
            await redis.quit();
            await pgPool.end();
        },
    });
    workerLogger.info('Worker process started');
    workerLogger.info('Active workers: ingestion');
}
bootstrapWorkers().catch((error) => {
    workerLogger.fatal({ error }, 'Failed to start worker process');
    process.exit(1);
});
//# sourceMappingURL=main.js.map