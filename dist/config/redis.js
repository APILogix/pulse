import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';
const redisLogger = logger.child({ component: 'redis' });
/**
 * Shared Redis connection for the application layer (sessions, caching, etc.).
 *
 * The ingestion module maintains its own dedicated Redis connection because
 * BullMQ requires `maxRetriesPerRequest: null` which is incompatible with
 * normal Redis usage. This separation is intentional.
 */
const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
        if (times > 10) {
            redisLogger.fatal({ attempts: times }, 'Redis retry limit exceeded — giving up');
            return null; // stop retrying
        }
        const delay = Math.min(times * 200, 5000);
        redisLogger.warn({ attempt: times, nextRetryMs: delay }, 'Redis connection retry');
        return delay;
    },
    reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some((e) => err.message.includes(e));
    },
};
export const redis = new Redis(env.REDIS_URL, redisOptions);
// Lifecycle events
redis.on('connect', () => {
    redisLogger.info('Redis connection established');
});
redis.on('ready', () => {
    redisLogger.info('Redis ready to accept commands');
});
redis.on('error', (err) => {
    redisLogger.error({ err }, 'Redis connection error');
});
redis.on('close', () => {
    redisLogger.warn('Redis connection closed');
});
/**
 * Connect to Redis — should be called during bootstrap BEFORE app.listen().
 */
export const connectRedis = async () => {
    await redis.connect();
    redisLogger.info({ url: env.REDIS_URL.replace(/\/\/.*@/, '//***@') }, 'Redis connected');
};
/**
 * Health check — returns true if Redis responds to PING.
 */
export const checkRedis = async () => {
    try {
        const res = await redis.ping();
        redisLogger.debug({ response: res }, 'Redis health check passed');
        return res === 'PONG';
    }
    catch (err) {
        redisLogger.error({ err }, 'Redis health check failed');
        return false;
    }
};
/**
 * Graceful shutdown — sends QUIT and waits for pending commands to flush.
 */
export const closeRedis = async () => {
    redisLogger.info('Closing Redis connection');
    await redis.quit();
    redisLogger.info('Redis connection closed');
};
//# sourceMappingURL=redis.js.map