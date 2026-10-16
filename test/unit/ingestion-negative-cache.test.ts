import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { IngestionService } from '../../src/modules/ingestion/service.js';
import { invalidApiKeyCache, evictApiKeyCache } from '../../src/config/lrucashe.js';

function sha256Hex(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}

describe('Tier 1.3: Ingestion Negative Caching for Invalid API Keys', () => {
  let service: IngestionService;
  let mockWriter: any;
  let mockValidator: any;
  let mockNormalizer: any;
  let mockDeadLetter: any;
  let mockPipeline: any;

  beforeEach(() => {
    invalidApiKeyCache?.clear?.();

    mockWriter = {
      resolveApiKey: vi.fn().mockResolvedValue(null), // Non-existent API key
      updateApiKeyLastUsed: vi.fn().mockResolvedValue(undefined),
    };
    const mockPool: any = { query: vi.fn() };
    const mockConfig: any = {
      maxBatchSize: 100,
      defaultRateLimitPerSecond: 100,
      defaultRateLimitPerMinute: 6000,
    };

    service = new IngestionService(mockPool, mockWriter, mockConfig);
  });

  it('Negative cache parameters: max 10000, ttl 30000ms', () => {
    expect(invalidApiKeyCache).toBeDefined();
    expect(invalidApiKeyCache.max).toBe(10_000);
    expect(invalidApiKeyCache.ttl).toBe(30_000);
  });

  it('Caches invalid API key for 30s keyed by hash, never storing the raw key', async () => {
    const rawKey = 'pulse_live_invalid_secret_key_99999';
    const keyHash = sha256Hex(rawKey);

    // Call 1: Misses negative cache, calls writer.resolveApiKey
    const res1 = await (service as any).resolveProject(rawKey);
    expect(res1).toBeNull();
    expect(mockWriter.resolveApiKey).toHaveBeenCalledTimes(1);

    // Assert key is stored as hash, NEVER raw key
    expect(invalidApiKeyCache.has(rawKey)).toBe(false);
    expect(invalidApiKeyCache.has(keyHash)).toBe(true);

    // Call 2: Hits negative cache, writer.resolveApiKey is NOT called again
    const res2 = await (service as any).resolveProject(rawKey);
    expect(res2).toBeNull();
    expect(mockWriter.resolveApiKey).toHaveBeenCalledTimes(1);
  });

  it('Evicts negative cache entry when API key is created or updated', async () => {
    const rawKey = 'pulse_live_pending_key_11111';
    const keyHash = sha256Hex(rawKey);

    // 1. Initial lookup fails and gets cached negatively
    await (service as any).resolveProject(rawKey);
    expect(invalidApiKeyCache.has(keyHash)).toBe(true);

    // 2. API key is now created / updated in control plane -> triggers eviction
    evictApiKeyCache(keyHash);

    // 3. Negative cache entry must be evicted
    expect(invalidApiKeyCache.has(keyHash)).toBe(false);

    // 4. Next lookup calls DB again
    await (service as any).resolveProject(rawKey);
    expect(mockWriter.resolveApiKey).toHaveBeenCalledTimes(2);
  });
});
