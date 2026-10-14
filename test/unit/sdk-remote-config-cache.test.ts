import { describe, expect, it, vi, beforeEach } from "vitest";
import { RedisLookupCache, type CachedRemoteConfigDoc } from "../../src/db/redis/lookup-cache.js";
import { RedisKeys } from "../../src/db/redis/keys.js";
import type { SchemaV1Config } from "../../src/modules/projects/sdk-config/schema-v1.js";

describe("Permanent Redis Remote Config Cache (No TTL)", () => {
  let mockRedis: any;
  let cache: RedisLookupCache;

  const sampleConfig: SchemaV1Config = {
    schemaVersion: 1,
    sdk: { projectId: "proj-123", environment: "production", release: "1.0.0" },
    meta: { configHash: "hash-abc", generatedAt: "2026-10-01T00:00:00.000Z", generatedBy: "pulse" },
    limits: {
      maxMemoryMb: "auto",
      maxQueueSize: 100000,
      maxPayloadSize: 4194304,
      maxSpansPerTrace: 5000,
      maxSpanAttributes: 200,
      maxAttributeLength: 8192,
      tenantGovernance: { enabled: false, quotaPerWindow: 10000, criticalReserve: 100, windowDurationMs: 60000, maxTenantsTracked: 1000 },
      persistenceGovernance: { adaptive: true, maxPersistPerMinute: 100000, budgetExceededLogIntervalMs: 60000 },
    },
    privacy: {
      capture: { body: false, query: false, cookies: false, headers: false, response: false },
      scrubbing: { enabled: true, fields: [], headers: [] },
      piiDetection: { enabled: true, maskIPs: true, maskEmails: true, maskPhones: true },
    },
    runtime: { configTtlSeconds: 300, staleWhileRevalidate: true },
    features: {
      crons: true, errors: true, logging: true, metrics: true, tracing: true,
      profiling: true, gcMonitoring: true, sessionReplay: true, requestCapture: true,
      runtimeMetrics: true, eventLoopMonitoring: true,
    },
    sampling: {
      logs: 1, crons: 1, spans: 1, errors: 1, events: 1, routes: {},
      traces: 1, metrics: 1, replays: 1, messages: 1, profiles: 1, requests: 1,
    },
    transport: {
      queue: { maxSize: 100000, criticalReserve: 10000, overflowStrategy: "drop_oldest" },
      retry: { backoff: "exponential", enabled: true, maxRetries: 3, baseDelayMs: 500 },
      routes: {
        events: { url: "http://localhost:5000/events", priority: "high", batchSize: 100, timeoutMs: 5000, compression: "gzip", flushIntervalMs: 2000 },
      },
      keepAlive: true,
      connections: { acquireTimeoutMs: 5000, maxTotalConnections: 100 },
    },
    entitlements: { crons: true, errors: true, logging: true, metrics: true, tracing: true, profiling: true, customSpans: true, customMetrics: true, sessionReplay: true, requestCapture: true },
    killswitches: { disableSDK: false, disableLogs: false, disableErrors: false, disableMetrics: false, disableTracing: false, disableProfiling: false, disableTransport: false },
    instrumentation: { pg: true, http: true, axios: false, fetch: true, https: true, redis: true, bullmq: true, mysql2: true, prisma: true, express: true, fastify: true, graphql: true, mongodb: true, eventEmitterPatch: true },
  };

  const sampleDoc: CachedRemoteConfigDoc = {
    version: 42,
    projectId: "proj-123",
    organizationId: "org-456",
    environmentId: "env-789",
    environment: "production",
    release: "1.0.0",
    etag: '"cfg-hash-abc"',
    configHash: "hash-abc",
    config: sampleConfig,
  };

  beforeEach(() => {
    const store = new Map<string, string>();
    mockRedis = {
      status: "ready",
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => { store.set(key, val); return "OK"; }),
      del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
      ttl: vi.fn(async (key: string) => store.has(key) ? -1 : -2),
      setex: vi.fn(),
      pipeline: vi.fn(() => ({
        del: vi.fn(function(this: any, k: string) { store.delete(k); return this; }),
        exec: vi.fn(async () => [[null, 1]]),
      })),
    };
    cache = new RedisLookupCache(mockRedis, 800);
  });

  it("stores remote config in Redis without TTL (never calls setex or EXPIRE)", async () => {
    await cache.setRemoteConfig(sampleDoc);

    // Verify client.set was called without TTL arguments
    expect(mockRedis.set).toHaveBeenCalledWith(
      "remote-config:proj-123",
      expect.any(String)
    );
    expect(mockRedis.setex).not.toHaveBeenCalled();

    // Verify programmatic TTL is -1 (no expiration)
    const ttl = await cache.getRemoteConfigTtl("proj-123");
    expect(ttl).toBe(-1);
  });

  it("serves warm remote config from Tier-0 in-memory L1 cache (<0.01ms) on second read", async () => {
    await cache.setRemoteConfig(sampleDoc);
    mockRedis.get.mockClear();

    // Second read should be served directly from in-memory L1 cache
    const cached = await cache.getRemoteConfig("proj-123");
    expect(cached).not.toBeNull();
    expect(cached?.version).toBe(42);
    expect(cached?.projectId).toBe("proj-123");
    expect(mockRedis.get).not.toHaveBeenCalled(); // 0 Redis network calls!
  });

  it("invalidates remote config from both L1 and Redis on update", async () => {
    await cache.setRemoteConfig(sampleDoc);
    expect(await cache.getRemoteConfig("proj-123")).not.toBeNull();

    await cache.invalidateRemoteConfig("proj-123");

    // After invalidation, should be null
    const result = await cache.getRemoteConfig("proj-123");
    expect(result).toBeNull();
  });

  it("enforces tenant isolation and versioning", async () => {
    const docA: CachedRemoteConfigDoc = { ...sampleDoc, projectId: "tenant-A", version: 1 };
    const docB: CachedRemoteConfigDoc = { ...sampleDoc, projectId: "tenant-B", version: 5 };

    await cache.setRemoteConfig(docA);
    await cache.setRemoteConfig(docB);

    const resA = await cache.getRemoteConfig("tenant-A");
    const resB = await cache.getRemoteConfig("tenant-B");

    expect(resA?.projectId).toBe("tenant-A");
    expect(resA?.version).toBe(1);

    expect(resB?.projectId).toBe("tenant-B");
    expect(resB?.version).toBe(5);
  });

  it("fails open gracefully when Redis throws an error", async () => {
    mockRedis.get.mockRejectedValueOnce(new Error("ECONNRESET"));

    // Should not throw, should return null so system falls back to PostgreSQL
    const res = await cache.getRemoteConfig("non-existent-proj");
    expect(res).toBeNull();
  });
});
