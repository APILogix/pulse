import { LRUCache } from "lru-cache";
import { logger } from "../../config/logger.js";
export class AnalyticsCache {
    defaultTtlSeconds = 120;
    log = logger.child({ component: "analytics-cache" });
    lru = new LRUCache({
        max: 5_000,
        // Safety default only. Each analytics endpoint supplies its own TTL on set.
        ttl: 120_000,
        updateAgeOnGet: true,
        ttlAutopurge: true,
    });
    getLru(key) {
        // Check has() before get() so cache-hit detection is based on key presence,
        // not value truthiness. Analytics currently caches result objects, but this
        // prevents false misses if a future payload is falsey.
        if (!this.lru.has(key)) {
            return { hit: false, data: undefined };
        }
        return { hit: true, data: this.lru.get(key) };
    }
    setLru(key, value, ttlSeconds = this.defaultTtlSeconds) {
        this.lru.set(key, value, { ttl: ttlSeconds * 1_000 });
        this.log.debug({ key, ttlSeconds }, "analytics LRU cache set");
    }
    async get(key) {
        const lruValue = this.getLru(key);
        if (lruValue.hit) {
            this.log.debug({ key, layer: "lru" }, "analytics cache hit");
            return { data: lruValue.data, source: "lru" };
        }
        this.log.debug({ key }, "analytics cache miss");
        return null;
    }
    async set(key, value, ttlSeconds = this.defaultTtlSeconds) {
        this.setLru(key, value, ttlSeconds);
    }
    async invalidate(key) {
        this.lru.delete(key);
        this.log.debug({ key }, "analytics cache key invalidated");
    }
    async invalidateProject(projectId) {
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
    async isHealthy() {
        // In-process LRU has no external dependency; it is always available.
        return true;
    }
}
//# sourceMappingURL=cache.js.map