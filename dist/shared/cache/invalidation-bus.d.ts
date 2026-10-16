/**
 * Distributed Cache Invalidation Bus (Tier 0.3).
 *
 * Propagates local cache evictions across Node.js cluster processes via Redis Pub/Sub.
 * Subscribes to `pulse:cache:invalidation`.
 * On reconnect or network partitions, flushes all registered L1 caches to prevent split-brain.
 */
import type { Redis } from 'ioredis';
export declare const INVALIDATION_CHANNEL = "pulse:cache:invalidation";
export interface InvalidationMessage {
    cache: string;
    key: string;
    ts: number;
}
export interface InvalidationL1Target {
    delete: (key: string) => void | boolean;
    clear: () => void;
}
/**
 * Register an L1 cache target to receive eviction broadcasts and reconnect flushes.
 */
export declare function registerL1Cache(name: string, target: InvalidationL1Target): void;
/**
 * Reset registered state for tests.
 */
export declare function resetInvalidationBusForTest(): void;
/**
 * Publish an eviction message to all cluster workers.
 */
export declare function publishInvalidation(cache: string, key: string): Promise<void>;
/**
 * Flush all registered L1 caches across this process.
 * Invoked on subscriber reconnect after connection loss to prevent serving stale data.
 */
export declare function flushAllL1Caches(): void;
/**
 * Handle incoming eviction broadcast message.
 */
export declare function handleInvalidationMessage(channel: string, payload: string): void;
/**
 * Initialize the invalidation bus with publisher and dedicated subscriber connection.
 */
export declare function initInvalidationBus(options?: {
    publisher?: Redis;
    subscriber?: Redis;
}): void;
//# sourceMappingURL=invalidation-bus.d.ts.map