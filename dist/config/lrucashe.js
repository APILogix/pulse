import { LRUCache } from 'lru-cache';
export const apiKeyCache = new LRUCache({
    max: 5000, // max keys
    ttl: 1000 * 60 * 5, // 5 minutes
    updateAgeOnGet: true,
    allowStale: false
});
//# sourceMappingURL=lrucashe.js.map