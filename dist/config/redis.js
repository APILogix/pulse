import './dns.js';
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';
const redisLogger = logger.child({ component: 'redis' });
export const REDIS_KEY_MAPPING = {
    // State: streams, rate limits, idempotency, alert cooldowns, remote-config, sessions/auth state
    ratelimit: 'state',
    idempotency: 'state',
    auth: 'state',
    'remote-config': 'state',
    alert: 'state',
    stream: 'state',
    security: 'state',
    circuit: 'state',
    replay: 'state',
    session: 'state',
    // Cache: lookup caches, dashboard results, query results, events
    lookup: 'cache',
    dashboard: 'cache',
    analytics: 'cache',
    event: 'cache',
    query: 'cache',
    stats: 'cache',
};
/**
 * Classify a Redis key into 'state' or 'cache'.
 */
export function classifyRedisKey(key) {
    let cleanKey = key;
    if (cleanKey.startsWith('ingest:')) {
        cleanKey = cleanKey.slice(7);
    }
    const prefix = cleanKey.split(':')[0];
    return (prefix ? REDIS_KEY_MAPPING[prefix] : undefined) ?? 'state';
}
export function parseRedisOptions(rawUrl) {
    const parsed = new URL(rawUrl);
    const isTls = parsed.protocol === 'rediss:';
    return {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        family: 4,
        tls: isTls ? { servername: parsed.hostname } : undefined,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: Math.max(env.REDIS_CONNECT_TIMEOUT_MS, 15000),
        commandTimeout: Math.max(env.REDIS_COMMAND_TIMEOUT_MS, 8000),
        keepAlive: 10000,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => {
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
}
export function createRedisClient(options) {
    const targetUrl = options.customUrl || options.fallbackUrl || env.REDIS_URL;
    const clientOptions = parseRedisOptions(targetUrl);
    const client = new Redis(clientOptions);
    client.on('connect', () => {
        redisLogger.info({ role: options.role }, `Redis ${options.role} connection established`);
    });
    client.on('ready', () => {
        redisLogger.info({ role: options.role }, `Redis ${options.role} ready to accept commands`);
    });
    client.on('error', (err) => {
        redisLogger.error({ err, role: options.role }, `Redis ${options.role} connection error`);
    });
    client.on('close', () => {
        redisLogger.warn({ role: options.role }, `Redis ${options.role} connection closed`);
    });
    return client;
}
export const redisCache = createRedisClient({
    role: 'cache',
    customUrl: env.REDIS_CACHE_URL,
    fallbackUrl: env.REDIS_URL,
});
export const redisState = createRedisClient({
    role: 'state',
    customUrl: env.REDIS_STATE_URL,
    fallbackUrl: env.REDIS_URL,
});
// Backward-compatible primary export
export const redis = redisState;
export function getRedisClientForPrefix(key) {
    const role = classifyRedisKey(key);
    return role === 'cache' ? redisCache : redisState;
}
async function ensureClientConnected(client, label) {
    if (client.status === 'ready')
        return;
    if (client.status === 'wait' || client.status === 'end' || client.status === 'close') {
        await client.connect();
        return;
    }
    await new Promise((resolve, reject) => {
        if (client.status === 'ready')
            return resolve();
        const onReady = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new Error(`Redis ${label} connection closed`)); };
        const onError = (err) => { cleanup(); reject(err); };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Redis ${label} connection wait timeout`));
        }, env.REDIS_CONNECT_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timer);
            client.off('ready', onReady);
            client.off('close', onClose);
            client.off('error', onError);
        }
        client.once('ready', onReady);
        client.once('close', onClose);
        client.once('error', onError);
    });
}
async function connectSingleClient(client, label, maxRetries) {
    let attempt = 0;
    while (true) {
        try {
            await ensureClientConnected(client, label);
            const response = await client.ping();
            if (response !== 'PONG') {
                throw new Error(`Redis ${label} health check failed during bootstrap: ${response}`);
            }
            redisLogger.info(`Redis ${label} connected`);
            return;
        }
        catch (error) {
            attempt++;
            if (attempt < maxRetries) {
                redisLogger.warn({ attempt, maxRetries, label, err: error?.message || String(error) }, `Redis ${label} bootstrap connection attempt failed, retrying...`);
                client.disconnect(false);
                await new Promise((r) => setTimeout(r, 500 * attempt));
                continue;
            }
            setTimeout(() => {
                void client.connect().catch(() => { });
            }, 2000);
            throw error;
        }
    }
}
export const connectRedis = async (maxRetries = 3) => {
    await Promise.all([
        connectSingleClient(redisState, 'state', maxRetries),
        connectSingleClient(redisCache, 'cache', maxRetries),
    ]);
};
export const checkRedis = async () => {
    try {
        await Promise.all([
            ensureClientConnected(redisState, 'state'),
            ensureClientConnected(redisCache, 'cache'),
        ]);
        const [statePong, cachePong] = await Promise.all([
            redisState.ping(),
            redisCache.ping(),
        ]);
        const ok = statePong === 'PONG' && cachePong === 'PONG';
        redisLogger.debug({ statePong, cachePong, ok }, 'Redis health check passed');
        return ok;
    }
    catch (err) {
        redisLogger.error({ err }, 'Redis health check failed');
        return false;
    }
};
export const closeRedis = async () => {
    redisLogger.info('Closing Redis connections');
    const closeSingle = async (client) => {
        if (client.status !== 'end') {
            try {
                await client.quit();
            }
            catch {
                client.disconnect(false);
            }
        }
    };
    await Promise.all([closeSingle(redisState), closeSingle(redisCache)]);
    redisLogger.info('Redis connections closed');
};
//# sourceMappingURL=redis.js.map