import { LRUCache } from "lru-cache";
import { logger } from "../../config/logger.js";
export class AnalyticsCache {
    redisClient;
    defaultTtlSeconds = 120;
    log = logger.child({ component: "analytics-cache" });
    lru = new LRUCache({
        max: 5_000,
        // Safety default only. Each analytics endpoint supplies its own TTL on set.
        ttl: 120_000,
        updateAgeOnGet: true,
    });
    constructor(redisClient) {
        this.redisClient = redisClient;
    }
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
    async getRedis(key) {
        try {
            const value = await this.redisClient.get(key);
            return value === null ? null : JSON.parse(value);
        }
        catch (err) {
            this.log.warn({ err, key }, "analytics Redis cache read failed");
            return null;
        }
    }
    async setRedis(key, value, ttlSeconds = this.defaultTtlSeconds) {
        try {
            const payload = JSON.stringify(value);
            if (payload === undefined) {
                // Redis stores strings. JSON.stringify(undefined) returns undefined,
                // which would make Redis and LRU disagree about whether a value exists.
                this.log.warn({ key }, "skipping Redis cache set for undefined value");
                return;
            }
            await this.redisClient.set(key, payload, "EX", ttlSeconds);
            this.log.debug({ key, ttlSeconds, payloadBytes: Buffer.byteLength(payload) }, "analytics Redis cache set");
        }
        catch (err) {
            // Redis is an optimization. Analytics reads must keep working from the
            // database when the distributed cache is unavailable.
            this.log.warn({ err, key }, "analytics Redis cache write failed");
        }
    }
    async get(key) {
        const lruValue = this.getLru(key);
        if (lruValue.hit) {
            this.log.debug({ key, layer: "lru" }, "analytics cache hit");
            return { data: lruValue.data, source: "lru" };
        }
        const redisValue = await this.getRedis(key);
        if (redisValue !== null) {
            // Promote Redis hits into LRU so hot keys avoid a network round trip.
            // The promoted entry uses the 2-minute local default; Redis remains the
            // distributed cache with the endpoint-specific TTL.
            this.setLru(key, redisValue);
            this.log.debug({ key, layer: "redis" }, "analytics cache hit");
            return { data: redisValue, source: "redis" };
        }
        this.log.debug({ key }, "analytics cache miss");
        return null;
    }
    async set(key, value, ttlSeconds = this.defaultTtlSeconds) {
        // Populate local memory first for this process, then Redis for the fleet.
        // Redis write failures are logged in setRedis and do not roll back LRU.
        this.setLru(key, value, ttlSeconds);
        await this.setRedis(key, value, ttlSeconds);
    }
    async invalidate(key) {
        this.lru.delete(key);
        try {
            await this.redisClient.del(key);
            this.log.debug({ key }, "analytics cache key invalidated");
        }
        catch (err) {
            // Best-effort invalidation. The endpoint TTL still bounds stale exposure
            // if Redis delete fails.
            this.log.warn({ err, key }, "analytics Redis cache invalidation failed");
        }
    }
    async invalidateProject(projectId) {
        // lru-cache has no cheap prefix delete, so writes clear the process-local
        // analytics cache. Redis is invalidated by project-specific key pattern.
        this.lru.clear();
        try {
            const stream = this.redisClient.scanStream({
                match: `analytics:*:${projectId}:*`,
                count: 100,
            });
            for await (const keys of stream) {
                if (keys.length > 0) {
                    await this.redisClient.del(...keys);
                }
            }
            this.log.debug({ projectId }, "analytics project cache invalidated");
        }
        catch (err) {
            // Writes should not fail because cache invalidation failed. Short TTLs
            // limit any stale distributed entries while Redis recovers.
            this.log.warn({ err, projectId }, "analytics Redis project invalidation failed");
        }
    }
    async isHealthy() {
        try {
            return (await this.redisClient.ping()) === "PONG";
        }
        catch (err) {
            this.log.warn({ err }, "analytics Redis health check failed");
            return false;
        }
    }
}
//# sourceMappingURL=cache.js.map