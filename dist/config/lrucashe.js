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
/** Published SDK configuration cache, keyed only by environment ID. */
export const sdkConfigCache = new LRUCache({
    max: 20000,
    ttl: 1000 * 30,
    updateAgeOnGet: false,
    allowStale: false,
});
export function sdkConfigCacheKey(environmentId) {
    return environmentId;
}
export function evictSdkConfigCache(environmentId) {
    sdkConfigCache.delete(environmentId);
}
//# sourceMappingURL=lrucashe.js.map