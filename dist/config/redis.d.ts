import './dns.js';
import { Redis } from 'ioredis';
export declare const redis: Redis;
/**
 * Connect to Redis — should be called during bootstrap BEFORE app.listen().
 */
export declare const connectRedis: (maxRetries?: number) => Promise<void>;
/**
 * Health check — reconnects a previously unavailable optional cache, then PINGs.
 */
export declare const checkRedis: () => Promise<boolean>;
/**
 * Graceful shutdown — sends QUIT and waits for pending commands to flush.
 */
export declare const closeRedis: () => Promise<void>;
//# sourceMappingURL=redis.d.ts.map