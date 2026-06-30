import { LRUCache } from 'lru-cache';
export const apiKeyCache = new LRUCache({
    max: 5000,
    ttl: 1000 * 60 * 30, // 30 minutes
    updateAgeOnGet: true,
    allowStale: false,
});
//# sourceMappingURL=lrucashe.js.map