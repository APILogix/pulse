import { LRUCache } from "lru-cache";
import { logger } from "../../config/logger.js";

/**
 * Analytics read cache — in-process LRU only (no Redis).
 *
 * The project intentionally runs Redis-free for now, so this cache is a single
 * in-process layer. The public API is kept stable (get/set/invalidate/
 * invalidateProject/isHealthy) so the AnalyticsService does not need to change.
 *
 * Tradeoffs (same as the rest of the LRU-only design):
 *   - Cache is per-process. Behind multiple nodes, each node warms its own
 *     copy. Short TTLs (≤5 min) bound cross-node staleness.
 *   - Cache does not survive restarts; the first request after a deploy
 *     repopulates from Postgres.
 *
 * `source` is always "lru" — retained in the return shape because the routes
 * surface `cacheLayer` to clients and the service type allows "lru" | "redis".
 */
interface CacheEntry<T> {
  data: T;
  source: "lru" | "redis";
}

interface LruLookup<T> {
  hit: boolean;
  data: T | undefined;
}

export class AnalyticsCache {
  private readonly defaultTtlSeconds = 120;
  private readonly log = logger.child({ component: "analytics-cache" });

  private readonly lru = new LRUCache<string, {}>({
    max: 5_000,
    // Safety default only. Each analytics endpoint supplies its own TTL on set.
    ttl: 120_000,
    updateAgeOnGet: true,
    ttlAutopurge: true,
  });

  getLru<T>(key: string): LruLookup<T> {
    // Check has() before get() so cache-hit detection is based on key presence,
    // not value truthiness. Analytics currently caches result objects, but this
    // prevents false misses if a future payload is falsey.
    if (!this.lru.has(key)) {
      return { hit: false, data: undefined };
    }
    return { hit: true, data: this.lru.get(key) as T | undefined };
  }

  setLru(key: string, value: unknown, ttlSeconds = this.defaultTtlSeconds): void {
    this.lru.set(key, value as {}, { ttl: ttlSeconds * 1_000 });
    this.log.debug({ key, ttlSeconds }, "analytics LRU cache set");
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const lruValue = this.getLru<T>(key);
    if (lruValue.hit) {
      this.log.debug({ key, layer: "lru" }, "analytics cache hit");
      return { data: lruValue.data as T, source: "lru" };
    }

    this.log.debug({ key }, "analytics cache miss");
    return null;
  }

  async set(key: string, value: unknown, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    this.setLru(key, value, ttlSeconds);
  }

  async invalidate(key: string): Promise<void> {
    this.lru.delete(key);
    this.log.debug({ key }, "analytics cache key invalidated");
  }

  async invalidateProject(projectId: string): Promise<void> {
    // Cache keys are shaped `analytics:${scope}:${projectId}:${hash}` (see
    // AnalyticsService.cacheKey). lru-cache has no native prefix delete, so we
    // scan the bounded key set (max 5,000) and drop only this project's entries
    // instead of clearing the whole cache and evicting every other tenant.
    const needle = `:${projectId}:`;
    let removed = 0;
    for (const key of this.lru.keys()) {
      if (key.includes(needle)) {
        this.lru.delete(key);
        removed += 1;
      }
    }
    this.log.debug({ projectId, removed }, "analytics project cache invalidated");
  }

  async isHealthy(): Promise<boolean> {
    // In-process LRU has no external dependency; it is always available.
    return true;
  }
}
