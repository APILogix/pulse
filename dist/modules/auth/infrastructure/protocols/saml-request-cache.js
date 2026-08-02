import { LRUCache } from 'lru-cache';
const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;
const store = new LRUCache({
    max: 20_000,
    ttl: SAML_REQUEST_TTL_MS,
    ttlAutopurge: true,
});
export const samlRequestIdCache = {
    async saveAsync(key, value) {
        const item = { value, createdAt: Date.now() };
        store.set(key, item);
        return item;
    },
    async getAsync(key) {
        return store.get(key)?.value ?? null;
    },
    async removeAsync(key) {
        if (!key)
            return null;
        const prev = store.get(key)?.value ?? null;
        store.delete(key);
        return prev;
    },
};
//# sourceMappingURL=saml-request-cache.js.map