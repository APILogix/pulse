import './dns.js';
import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
export type RedisStoreRole = 'state' | 'cache';
export declare const REDIS_KEY_MAPPING: Record<string, RedisStoreRole>;
/**
 * Classify a Redis key into 'state' or 'cache'.
 */
export declare function classifyRedisKey(key: string): RedisStoreRole;
export declare function parseRedisOptions(rawUrl: string): RedisOptions;
export declare function createRedisClient(options: {
    role: RedisStoreRole;
    customUrl?: string | undefined;
    fallbackUrl?: string | undefined;
}): Redis;
export declare const redisCache: Redis;
export declare const redisState: Redis;
export declare const redis: Redis;
export declare function getRedisClientForPrefix(key: string): Redis;
export declare const connectRedis: (maxRetries?: number) => Promise<void>;
export declare const checkRedis: () => Promise<boolean>;
export declare const closeRedis: () => Promise<void>;
//# sourceMappingURL=redis.d.ts.map