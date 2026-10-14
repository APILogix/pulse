import './dns.js';
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
const parsedRedisUrl = new URL(env.REDIS_URL);
const isTls = parsedRedisUrl.protocol === 'rediss:';
const redisOptions = {
    host: parsedRedisUrl.hostname,
    port: Number(parsedRedisUrl.port) || 6379,
    password: parsedRedisUrl.password ? decodeURIComponent(parsedRedisUrl.password) : undefined,
    username: parsedRedisUrl.username ? decodeURIComponent(parsedRedisUrl.username) : undefined,
    family: 4,
    tls: isTls ? { servername: parsedRedisUrl.hostname } : undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: Math.max(env.REDIS_CONNECT_TIMEOUT_MS, 15000),
    commandTimeout: Math.max(env.REDIS_COMMAND_TIMEOUT_MS, 8000),
    keepAlive: 10000,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => {
        // Resilient continuous background reconnection to survive WAN packet drops
        const delay = Math.min(times * 250, 3000);
        if (times % 5 === 0) {
            redisLogger.warn({ attempt: times, nextRetryMs: delay }, 'Redis background reconnection in progress');
        }
        return delay;
    },
    reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNREFUSED'];
        return targetErrors.some((e) => err.message.includes(e));
    },
};
export const redis = new Redis(redisOptions);
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
let reconnectPromise = null;
async function ensureRedisConnected() {
    if (redis.status === 'ready')
        return;
    if (redis.status === 'wait' || redis.status === 'end' || redis.status === 'close') {
        if (!reconnectPromise) {
            reconnectPromise = redis.connect().finally(() => {
                reconnectPromise = null;
            });
        }
        await reconnectPromise;
        return;
    }
    // If connecting/reconnecting, wait until ready or closed
    await new Promise((resolve, reject) => {
        if (redis.status === 'ready')
            return resolve();
        const onReady = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new Error('Redis connection closed')); };
        const onError = (err) => { cleanup(); reject(err); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Redis connection wait timeout')); }, env.REDIS_CONNECT_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timer);
            redis.off('ready', onReady);
            redis.off('close', onClose);
            redis.off('error', onError);
        }
        redis.once('ready', onReady);
        redis.once('close', onClose);
        redis.once('error', onError);
    });
}
/**
 * Connect to Redis — should be called during bootstrap BEFORE app.listen().
 */
export const connectRedis = async (maxRetries = 3) => {
    let attempt = 0;
    while (true) {
        try {
            await ensureRedisConnected();
            const response = await redis.ping();
            if (response !== 'PONG') {
                throw new Error(`Redis health check failed during bootstrap: ${response}`);
            }
            redisLogger.info('Redis connected');
            return;
        }
        catch (error) {
            attempt++;
            if (attempt < maxRetries) {
                redisLogger.warn({ attempt, maxRetries, err: error?.message || String(error) }, 'Redis bootstrap connection attempt failed, retrying...');
                redis.disconnect(false);
                await new Promise((r) => setTimeout(r, 500 * attempt));
                continue;
            }
            // Leave the client with a background reconnect attempt so that as soon as
            // network/Redis recovers, the optional cache becomes ready automatically.
            setTimeout(() => {
                void redis.connect().catch(() => { });
            }, 2000);
            throw error;
        }
    }
};
/**
 * Health check — reconnects a previously unavailable optional cache, then PINGs.
 */
export const checkRedis = async () => {
    try {
        await ensureRedisConnected();
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
    if (redis.status !== 'end') {
        try {
            await redis.quit();
        }
        catch {
            redis.disconnect(false);
        }
    }
    redisLogger.info('Redis connection closed');
};
//# sourceMappingURL=redis.js.map