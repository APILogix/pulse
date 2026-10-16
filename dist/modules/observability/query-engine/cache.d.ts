import type { ExplorerQuery } from './types.js';
/**
 * Live-tail / near-live queries are not cached because events are constantly streaming in.
 * Only queries whose time range strictly closed > 5 minutes ago are eligible for caching.
 */
export declare function isObservabilityQueryCacheable(query: ExplorerQuery, now?: number): boolean;
/**
 * Builds a tenant-scoped cache key in the format:
 * key = query:obs:<org_id>:<resource>:<query_hash>:<floored_time_bucket_1m>
 */
export declare function buildObservabilityQueryCacheKey(orgId: string, resourceName: string, query: ExplorerQuery, ctx: {
    projectId?: string | undefined;
    allowedProjectIds?: string[] | undefined;
}): string;
/**
 * Retrieve cached query results if available in Redis.
 */
export declare function getCachedObservabilityQuery<T>(key: string): Promise<T | null>;
/**
 * Cache query results in Redis with a 30s TTL.
 */
export declare function setCachedObservabilityQuery<T>(key: string, data: T, ttlSeconds?: number): Promise<void>;
//# sourceMappingURL=cache.d.ts.map