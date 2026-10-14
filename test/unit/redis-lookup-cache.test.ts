import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisLookupCache } from "../../src/db/redis/lookup-cache.js";
import { compileInitial } from "../../src/modules/projects/sdk-config/compiler.js";
import type { ApiKeyMapping, DeliveryResult, OperatorOverride } from "../../src/modules/projects/sdk-config/delivery.js";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("RedisLookupCache Unit Tests", () => {
  let mockStore: Map<string, string>;
  let mockRedis: any;
  let cache: RedisLookupCache;

  beforeEach(() => {
    mockStore = new Map<string, string>();
    mockRedis = {
      get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
      setex: vi.fn(async (key: string, _ttl: number, value: string) => {
        mockStore.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => {
        mockStore.delete(key);
        return 1;
      }),
      pipeline: vi.fn(() => {
        const queue: Array<() => void> = [];
        return {
          del: (key: string) => {
            queue.push(() => mockStore.delete(key));
            return this;
          },
          exec: async () => {
            queue.forEach((fn) => fn());
            return [];
          },
        };
      }),
    };
    cache = new RedisLookupCache(mockRedis);
  });

  describe("API Key Mapping Cache", () => {
    it("bounds stalled Redis reads and skips reads during cooldown", async () => {
      vi.useFakeTimers();
      try {
        mockRedis.get.mockImplementation(() => new Promise(() => {}));
        const pending = cache.getApiKeyMapping("slow-key");
        await vi.advanceTimersByTimeAsync(100);
        expect(await pending).toBeNull();
        expect(await cache.getApiKeyMapping("another-key")).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledTimes(1);
        mockRedis.get.mockResolvedValue(null);
        await vi.advanceTimersByTimeAsync(5000);
        expect(await cache.getApiKeyMapping("recovered-key")).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
    const rawKey = "pv_live_123456789012345678901234.abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const secretHash = sha256Hex(rawKey);
    const mapping: ApiKeyMapping = {
      organizationId: "org-123",
      projectId: "proj-456",
      defaultEnvironmentId: "env-789",
      allowedEnvironmentIds: ["env-789"],
    };

    it("returns null on cache miss", async () => {
      const result = await cache.getApiKeyMapping(rawKey);
      expect(result).toBeNull();
    });

    it("stores and retrieves API key mapping with constant-time verification", async () => {
      await cache.setApiKeyMapping(rawKey, mapping, secretHash);
      const retrieved = await cache.getApiKeyMapping(rawKey);
      expect(retrieved).toEqual(mapping);
    });

    it("rejects cached entry if raw key hash does not match stored secret hash", async () => {
      await cache.setApiKeyMapping(rawKey, mapping, "wrong_hash_123456");
      const retrieved = await cache.getApiKeyMapping(rawKey);
      expect(retrieved).toBeNull();
    });

    it("invalidates API key cache properly", async () => {
      await cache.setApiKeyMapping(rawKey, mapping, secretHash);
      expect(await cache.getApiKeyMapping(rawKey)).not.toBeNull();

      await cache.invalidateApiKey(secretHash);
      expect(await cache.getApiKeyMapping(rawKey)).toBeNull();
    });
  });

  describe("Compiled SDK Config Cache", () => {
    const envId = "env-uuid-1111";
    const orgId = "org-uuid-2222";
    const projId = "proj-uuid-3333";
    const envSlug = "production";

    const config = compileInitial(
      { projectId: projId, environment: envSlug },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );

    it("stores and loads compiled config by environmentId", async () => {
      await cache.setCompiledConfigByEnv(envId, { revisionNo: 3, compiledSnapshot: config });
      const loaded = await cache.getCompiledConfigByEnv(envId);
      expect(loaded).toEqual({
        revisionNo: 3,
        compiledSnapshot: config,
      });
    });

    it("stores and loads compiled config by metadata (org + proj + envSlug)", async () => {
      await cache.setCompiledConfigByMeta(orgId, projId, envSlug, {
        revisionNo: 5,
        environmentId: envId,
        compiledSnapshot: config,
      });

      const loaded = await cache.getCompiledConfigByMeta(orgId, projId, envSlug);
      expect(loaded).toEqual({
        revisionNo: 5,
        environmentId: envId,
        compiledSnapshot: config,
      });
    });

    it("invalidates environment and metadata caches", async () => {
      await cache.setCompiledConfigByEnv(envId, { revisionNo: 3, compiledSnapshot: config });
      await cache.setCompiledConfigByMeta(orgId, projId, envSlug, {
        revisionNo: 5,
        environmentId: envId,
        compiledSnapshot: config,
      });

      await cache.invalidateSdkConfig(envId, orgId, projId, envSlug);
      expect(await cache.getCompiledConfigByEnv(envId)).toBeNull();
      expect(await cache.getCompiledConfigByMeta(orgId, projId, envSlug)).toBeNull();
    });
  });

  describe("Organization Entitlement Override Cache", () => {
    const orgId = "org-enterprise-999";
    const override: OperatorOverride = {
      limits: {
        persistenceGovernance: {
          maxPersistPerMinute: 500_000,
          adaptive: true,
          budgetExceededLogIntervalMs: 60_000,
        },
      },
    };

    it("returns null on cache miss and caches override", async () => {
      expect(await cache.getOrgEntitlementOverride(orgId)).toBeNull();

      await cache.setOrgEntitlementOverride(orgId, override);
      const cached = await cache.getOrgEntitlementOverride(orgId);
      expect(cached).toEqual(override);
    });

    it("caches undefined override (for default plans without custom overrides)", async () => {
      await cache.setOrgEntitlementOverride(orgId, undefined);
      const cached = await cache.getOrgEntitlementOverride(orgId);
      expect(cached).toBeUndefined();
    });

    it("invalidates org override cache", async () => {
      await cache.setOrgEntitlementOverride(orgId, override);
      await cache.invalidateOrgOverride(orgId);
      expect(await cache.getOrgEntitlementOverride(orgId)).toBeNull();
    });
  });

  describe("Init Delivery Result Fast-Path", () => {
    const rawKey = "pv_live_fast_key_12345678901234";
    const hintsHash = "hints_hash_abc";
    const config = compileInitial(
      { projectId: "proj-1", environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const deliveryResult: DeliveryResult = {
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      revisionNo: 1,
      config,
      etag: '"etag-12345"',
      usedDefaultFallback: false,
    };

    it("caches and returns complete init delivery snapshot", async () => {
      await cache.setInitDelivery(rawKey, hintsHash, deliveryResult);
      const retrieved = await cache.getInitDelivery(rawKey, hintsHash);
      expect(retrieved).toEqual(deliveryResult);
    });
  });

  describe("Fail-Open Resilience", () => {
    it("returns null gracefully when Redis client throws an error", async () => {
      const brokenRedis = {
        get: vi.fn().mockRejectedValue(new Error("Redis connection timeout")),
        setex: vi.fn().mockRejectedValue(new Error("Redis connection timeout")),
        del: vi.fn().mockRejectedValue(new Error("Redis connection timeout")),
      };
      const brokenCache = new RedisLookupCache(brokenRedis as any);

      expect(await brokenCache.getApiKeyMapping("key")).toBeNull();
      expect(await brokenCache.getCompiledConfigByEnv("env")).toBeNull();
      expect(await brokenCache.getOrgEntitlementOverride("org")).toBeNull();
      expect(await brokenCache.getInitDelivery("key", "hints")).toBeNull();

      // Setters should not throw
      await expect(brokenCache.setApiKeyMapping("key", {} as any, "hash")).resolves.not.toThrow();
    });
  });
});
