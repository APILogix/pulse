import { Redis } from 'ioredis';
export declare const redis: Redis;
/**
 * Connect to Redis — should be called during bootstrap BEFORE app.listen().
 */
export declare const connectRedis: () => Promise<void>;
/**
 * Health check — returns true if Redis responds to PING.
 */
export declare const checkRedis: () => Promise<boolean>;
/**
 * Graceful shutdown — sends QUIT and waits for pending commands to flush.
 */
export declare const closeRedis: () => Promise<void>;
//# sourceMappingURL=redis.d.ts.map