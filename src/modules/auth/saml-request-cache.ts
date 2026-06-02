/**
 * InResponseTo cache for @node-saml (LRU, no Redis).
 */
import type { CacheItem, CacheProvider } from '@node-saml/node-saml';
import { LRUCache } from 'lru-cache';

const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

const store = new LRUCache<string, CacheItem>({
  max: 20_000,
  ttl: SAML_REQUEST_TTL_MS,
  ttlAutopurge: true,
});

export const samlRequestIdCache: CacheProvider = {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const item: CacheItem = { value, createdAt: Date.now() };
    store.set(key, item);
    return item;
  },
  async getAsync(key: string): Promise<string | null> {
    return store.get(key)?.value ?? null;
  },
  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const prev = store.get(key)?.value ?? null;
    store.delete(key);
    return prev;
  },
};
