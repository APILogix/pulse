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
export declare class AnalyticsCache {
    private readonly defaultTtlSeconds;
    private readonly log;
    private readonly lru;
    getLru<T>(key: string): LruLookup<T>;
    setLru(key: string, value: unknown, ttlSeconds?: number): void;
    get<T>(key: string): Promise<CacheEntry<T> | null>;
    set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
    invalidate(key: string): Promise<void>;
    invalidateProject(projectId: string): Promise<void>;
    isHealthy(): Promise<boolean>;
}
export {};
//# sourceMappingURL=cache.d.ts.map