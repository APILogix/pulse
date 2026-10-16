/**
 * Distributed Cache Invalidation Bus (Tier 0.3).
 *
 * Propagates local cache evictions across Node.js cluster processes via Redis Pub/Sub.
 * Subscribes to `pulse:cache:invalidation`.
 * On reconnect or network partitions, flushes all registered L1 caches to prevent split-brain.
 */
import type { Redis } from 'ioredis';
import { redis } from '../../config/redis.js';
import { CacheFlags } from '../../config/cache-flags.js';
import { logger } from '../../config/logger.js';

export const INVALIDATION_CHANNEL = 'pulse:cache:invalidation';

export interface InvalidationMessage {
  cache: string;
  key: string;
  ts: number;
}

export interface InvalidationL1Target {
  delete: (key: string) => void | boolean;
  clear: () => void;
}

const registeredCaches = new Map<string, InvalidationL1Target>();
let publisherClient: Redis = redis;
let subscriberClient: Redis | null = null;
let isInitialized = false;

const log = logger.child({ component: 'cache-invalidation-bus' });

/**
 * Register an L1 cache target to receive eviction broadcasts and reconnect flushes.
 */
export function registerL1Cache(name: string, target: InvalidationL1Target): void {
  registeredCaches.set(name, target);
}

/**
 * Reset registered state for tests.
 */
export function resetInvalidationBusForTest(): void {
  subscriberClient = null;
  publisherClient = redis;
  isInitialized = false;
}

/**
 * Publish an eviction message to all cluster workers.
 */
export async function publishInvalidation(cache: string, key: string): Promise<void> {
  if (!CacheFlags.cacheInvalidationBus) return;

  const msg: InvalidationMessage = {
    cache,
    key,
    ts: Date.now(),
  };

  try {
    await publisherClient.publish(INVALIDATION_CHANNEL, JSON.stringify(msg));
  } catch (err) {
    log.warn({ err, cache, key }, 'Failed to publish cache invalidation message; local eviction was applied');
  }
}

/**
 * Flush all registered L1 caches across this process.
 * Invoked on subscriber reconnect after connection loss to prevent serving stale data.
 */
export function flushAllL1Caches(): void {
  log.info('Flushing all local L1 caches following subscriber reconnect');
  for (const [name, target] of registeredCaches.entries()) {
    try {
      target.clear();
    } catch (err) {
      log.error({ err, cache: name }, 'Error clearing L1 cache on reconnect');
    }
  }
}

/**
 * Handle incoming eviction broadcast message.
 */
export function handleInvalidationMessage(channel: string, payload: string): void {
  if (channel !== INVALIDATION_CHANNEL) return;

  try {
    const data = JSON.parse(payload) as InvalidationMessage;
    const target = registeredCaches.get(data.cache);
    if (target) {
      target.delete(data.key);
    }
  } catch (err) {
    log.warn({ err, payload }, 'Failed to parse incoming cache invalidation message');
  }
}

/**
 * Initialize the invalidation bus with publisher and dedicated subscriber connection.
 */
export function initInvalidationBus(options?: {
  publisher?: Redis;
  subscriber?: Redis;
}): void {
  if (isInitialized && !options) return;

  if (options?.publisher) {
    publisherClient = options.publisher;
  } else {
    publisherClient = redis;
  }

  if (options?.subscriber !== undefined) {
    subscriberClient = options.subscriber;
  } else if (process.env.NODE_ENV !== 'test') {
    // Dedicated subscriber connection required for Redis pub/sub
    try {
      subscriberClient = redis.duplicate();
    } catch {
      subscriberClient = null;
    }
  }

  if (subscriberClient) {
    subscriberClient.on('message', handleInvalidationMessage);
    subscriberClient.on('reconnecting', flushAllL1Caches);
    subscriberClient.on('connect', flushAllL1Caches);

    void subscriberClient.subscribe(INVALIDATION_CHANNEL).catch((err) => {
      log.warn({ err }, 'Failed to subscribe to cache invalidation channel');
    });
  }

  isInitialized = true;
}
