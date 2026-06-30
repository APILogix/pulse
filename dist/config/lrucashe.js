import { LRUCache } from 'lru-cache';
export const apiKeyCache = new LRUCache({
    max: 5000,
    ttl: 1000 * 60 * 30, // 30 minutes
    updateAgeOnGet: true,
    allowStale: false,
});
export const alertThresholdCache = new LRUCache({
    max: 20000,
    ttl: 1000 * 60, // 60 seconds
    updateAgeOnGet: false,
    allowStale: false,
});
/** Build the cache key for an org/project alert-threshold config. */
export function alertThresholdCacheKey(orgId, projectId) {
    return `${orgId}:${projectId ?? 'org'}`;
}
/** Evict a cached alert-threshold config after an update. */
export function evictAlertThresholdCache(orgId, projectId) {
    alertThresholdCache.delete(alertThresholdCacheKey(orgId, projectId));
}
export const sdkConfigCache = new LRUCache({
    max: 20000,
    ttl: 1000 * 30, // 30 seconds
    updateAgeOnGet: false,
    allowStale: false,
});
/** Build the cache key for a resolved SDK config set. */
export function sdkConfigCacheKey(orgId, projectId, environment, platform) {
    return `${orgId}:${projectId ?? 'org'}:${environment}:${platform ?? 'all'}`;
}
/**
 * Evict every cached SDK config set for an org. Called on any config mutation.
 * LRUCache has no prefix delete, so we scan keys (bounded by `max`) and drop
 * those for the org — cheap relative to a DB round-trip and keeps reads correct.
 */
export function evictSdkConfigCache(orgId) {
    const prefix = `${orgId}:`;
    for (const key of sdkConfigCache.keys()) {
        if (key.startsWith(prefix))
            sdkConfigCache.delete(key);
    }
}
//# sourceMappingURL=lrucashe.js.map