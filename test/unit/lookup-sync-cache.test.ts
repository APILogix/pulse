import { describe, it, expect } from 'vitest';
import { LRUCache } from 'lru-cache';
import { recentInitSyncTimestamps } from '../../src/shared/logdb/lookup-sync.js';

describe('Tier 1.2: Bounded Cache in lookup-sync.ts', () => {
  it('recentInitSyncTimestamps is an instance of LRUCache, not an unbounded Map', () => {
    expect(recentInitSyncTimestamps).toBeInstanceOf(LRUCache);
    expect(recentInitSyncTimestamps).not.toBeInstanceOf(Map);
  });

  it('recentInitSyncTimestamps has max: 10000, ttl: 60000, and ttlAutopurge: true', () => {
    const lru = recentInitSyncTimestamps as unknown as LRUCache<string, number>;
    expect(lru.max).toBe(10_000);
    expect(lru.ttl).toBe(60_000);
    expect((lru as any).ttlAutopurge).toBe(true);
  });

  it('Evicts items beyond max: 10000 to prevent unbounded memory growth', () => {
    const lru = recentInitSyncTimestamps as unknown as LRUCache<string, number>;
    lru.clear();

    // Populate with 10,050 entries
    for (let i = 0; i < 10_050; i++) {
      lru.set(`key_${i}`, Date.now());
    }

    expect(lru.size).toBeLessThanOrEqual(10_000);
    // Oldest key should have been evicted
    expect(lru.has('key_0')).toBe(false);
    // Latest key should be present
    expect(lru.has('key_10049')).toBe(true);

    lru.clear();
  });
});
