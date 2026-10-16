import { LRUCache } from 'lru-cache';
import { registerL1Cache, publishInvalidation } from '../shared/cache/invalidation-bus.js';
export const apiKeyCache = new LRUCache({
    max: 5000,
    ttl: 1000 * 60, // 60 seconds backstop TTL (Tier 0.3)
    updateAgeOnGet: false,
    allowStale: false,
});
/**
 * Separate bounded LRU for invalid API keys (Tier 1.3 negative caching).
 * Max: 10,000, TTL: 30 seconds.
 * Keyed strictly by SHA-256 hash of the key, NEVER the raw key.
 */
export const invalidApiKeyCache = new LRUCache({
    max: 10_000,
    ttl: 30_000, // 30 seconds
    updateAgeOnGet: false,
    allowStale: false,
});
registerL1Cache('apiKey', {
    delete: (key) => {
        apiKeyCache.delete(key);
        invalidApiKeyCache.delete(key);
    },
    clear: () => {
        apiKeyCache.clear();
        invalidApiKeyCache.clear();
    },
});
export function evictApiKeyCache(keyHash) {
    apiKeyCache.delete(keyHash);
    invalidApiKeyCache.delete(keyHash);
    void publishInvalidation('apiKey', keyHash);
}
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