import { createHash } from "node:crypto";
import { logger } from "../../config/logger.js";
export class AnalyticsService {
    repository;
    cache;
    shortTtlSeconds = 120;
    mediumTtlSeconds = 120;
    longTtlSeconds = 300;
    log = logger.child({ component: "analytics-service" });
    inFlight = new Map();
    constructor(repository, cache) {
        this.repository = repository;
        this.cache = cache;
    }
    async listEvents(projectId, query) {
        return this.cached(projectId, "events", query, this.shortTtlSeconds, () => this.timed(() => this.repository.listEvents(projectId, query)));
    }
    async getEventDetails(projectId, eventId) {
        const result = await this.cached(projectId, "event-details", { eventId }, this.longTtlSeconds, () => this.timedData(() => this.repository.getEventDetails(projectId, eventId)));
        if (!result.data) {
            return null;
        }
        const response = {
            data: result.data,
            queryTimeMs: result.queryTimeMs,
            cacheHit: result.cacheHit,
            cacheLookupMs: result.cacheLookupMs,
        };
        if (result.cacheLayer !== undefined) {
            response.cacheLayer = result.cacheLayer;
        }
        if (result.deduped !== undefined) {
            response.deduped = result.deduped;
        }
        return response;
    }
    async getRequestOverview(projectId, range) {
        return this.cached(projectId, "request-overview", range, this.mediumTtlSeconds, () => this.timedData(() => this.repository.getRequestOverview(projectId, range)));
    }
    async getDashboard(projectId, range) {
        return this.cached(projectId, "dashboard", range, this.shortTtlSeconds, () => this.timedData(() => this.repository.getDashboard(projectId, range)));
    }
    async listErrorGroups(projectId, query) {
        return this.cached(projectId, "error-groups", query, this.shortTtlSeconds, () => this.timed(() => this.repository.listErrorGroups(projectId, query)));
    }
    async updateErrorGroup(projectId, fingerprint, update) {
        const result = await this.repository.updateErrorGroup(projectId, fingerprint, update);
        await this.cache.invalidateProject(projectId);
        return result;
    }
    async resolveErrorGroup(projectId, fingerprint, resolvedBy) {
        const update = { isResolved: true };
        if (resolvedBy !== undefined) {
            update.resolvedBy = resolvedBy;
        }
        return this.updateErrorGroup(projectId, fingerprint, update);
    }
    async getHealth(projectId) {
        const [database, cache] = await Promise.all([
            this.repository.checkHealth(projectId),
            this.cache.isHealthy(),
        ]);
        return {
            status: database && cache ? "healthy" : "degraded",
            database: database ? "connected" : "disconnected",
            cache: cache ? "connected" : "disconnected",
            checkedAt: new Date().toISOString(),
        };
    }
    async cached(projectId, scope, input, ttlSeconds, fetcher) {
        const lookupStartedAt = Date.now();
        const key = this.cacheKey(projectId, scope, input);
        const cached = await this.cache.get(key);
        if (cached) {
            const cacheLookupMs = Date.now() - lookupStartedAt;
            this.log.debug({ key, projectId, scope, cacheLayer: cached.source, cacheLookupMs }, "analytics cache served response");
            return {
                ...cached.data,
                queryTimeMs: 0,
                cacheHit: true,
                cacheLayer: cached.source,
                cacheLookupMs,
            };
        }
        const cacheLookupMs = Date.now() - lookupStartedAt;
        // Without this map, a burst of identical cache misses would run the same
        // expensive analytics query once per request. The first request owns the DB
        // fetch and cache population; followers await that promise.
        const existing = this.inFlight.get(key);
        if (existing) {
            const { result } = (await existing);
            this.log.debug({ key, projectId, scope, cacheLookupMs }, "analytics cache miss joined in-flight fetch");
            return {
                ...result,
                cacheHit: false,
                cacheLookupMs,
                deduped: true,
            };
        }
        const promise = (async () => {
            const result = await fetcher();
            await this.cache.set(key, result, ttlSeconds);
            return { result, deduped: false };
        })();
        this.inFlight.set(key, promise);
        try {
            const { result } = await promise;
            this.log.debug({
                key,
                projectId,
                scope,
                ttlSeconds,
                queryTimeMs: result.queryTimeMs,
                cacheLookupMs,
            }, "analytics cache populated after miss");
            return {
                ...result,
                cacheHit: false,
                cacheLookupMs,
            };
        }
        finally {
            this.inFlight.delete(key);
        }
    }
    async timed(fetcher) {
        const startedAt = Date.now();
        const result = await fetcher();
        return {
            ...result,
            queryTimeMs: Date.now() - startedAt,
        };
    }
    async timedData(fetcher) {
        const startedAt = Date.now();
        const data = await fetcher();
        return {
            data,
            queryTimeMs: Date.now() - startedAt,
        };
    }
    cacheKey(projectId, scope, input) {
        const stableInput = this.stableStringify(input);
        const hash = createHash("sha256")
            .update(stableInput)
            .digest("hex");
        return `analytics:${scope}:${projectId}:${hash}`;
    }
    stableStringify(input) {
        const seen = new WeakSet();
        const normalize = (value) => {
            if (value instanceof Date) {
                return value.toISOString();
            }
            if (Array.isArray(value)) {
                return value.map((item) => normalize(item));
            }
            if (value && typeof value === "object") {
                if (seen.has(value)) {
                    throw new TypeError("Cannot build analytics cache key for cyclic input");
                }
                seen.add(value);
                const normalized = {};
                for (const key of Object.keys(value).sort()) {
                    const item = value[key];
                    if (item !== undefined) {
                        normalized[key] = normalize(item);
                    }
                }
                seen.delete(value);
                return normalized;
            }
            return value;
        };
        // JSON.stringify preserves object insertion order. Sorting object keys here
        // makes semantically identical filter objects produce the same cache key.
        return JSON.stringify(normalize(input));
    }
}
//# sourceMappingURL=service.js.map