import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { redisCache } from '../../../config/redis.js';
import { CacheFlags } from '../../../config/cache-flags.js';
import { recordCacheRequest, recordCacheOp } from '../../../config/perf/metrics.js';
/**
 * Live-tail / near-live queries are not cached because events are constantly streaming in.
 * Only queries whose time range strictly closed > 5 minutes ago are eligible for caching.
 */
export function isObservabilityQueryCacheable(query, now = Date.now()) {
    if (!query.timeRange?.to)
        return false;
    const toMs = query.timeRange.to.getTime();
    const fiveMinutesMs = 5 * 60 * 1000;
    return now - toMs >= fiveMinutesMs;
}
/**
 * Builds a tenant-scoped cache key in the format:
 * key = query:obs:<org_id>:<resource>:<query_hash>:<floored_time_bucket_1m>
 */
export function buildObservabilityQueryCacheKey(orgId, resourceName, query, ctx) {
    const flooredBucket = Math.floor(query.timeRange.to.getTime() / 60_000);
    const normalized = {
        resource: resourceName,
        filters: query.filters,
        sort: query.sort,
        search: query.search ?? null,
        limit: query.limit,
        cursor: query.cursor ?? null,
        projectId: ctx.projectId ?? null,
        allowedProjectIds: ctx.allowedProjectIds ? [...ctx.allowedProjectIds].sort() : null,
        fromBucket: Math.floor(query.timeRange.from.getTime() / 60_000),
    };
    const queryHash = createHash('sha256')
        .update(JSON.stringify(normalized))
        .digest('hex')
        .slice(0, 16);
    return `query:obs:${orgId}:${resourceName}:${queryHash}:${flooredBucket}`;
}
/**
 * Retrieve cached query results if available in Redis.
 */
export async function getCachedObservabilityQuery(key) {
    if (!CacheFlags.observabilityResultCache)
        return null;
    const start = performance.now();
    try {
        const raw = await redisCache.get(key);
        const duration = performance.now() - start;
        recordCacheOp('get', 'observabilityQuery', duration);
        if (raw) {
            recordCacheRequest('observabilityQuery', 'hit');
            return JSON.parse(raw);
        }
        recordCacheRequest('observabilityQuery', 'miss');
    }
    catch {
        const duration = performance.now() - start;
        recordCacheOp('get', 'observabilityQuery', duration);
        recordCacheRequest('observabilityQuery', 'miss');
    }
    return null;
}
/**
 * Cache query results in Redis with a 30s TTL.
 */
export async function setCachedObservabilityQuery(key, data, ttlSeconds = 30) {
    if (!CacheFlags.observabilityResultCache)
        return;
    const start = performance.now();
    try {
        await redisCache.set(key, JSON.stringify(data), 'EX', ttlSeconds);
        const duration = performance.now() - start;
        recordCacheOp('set', 'observabilityQuery', duration);
    }
    catch {
        const duration = performance.now() - start;
        recordCacheOp('set', 'observabilityQuery', duration);
    }
}
//# sourceMappingURL=cache.js.map