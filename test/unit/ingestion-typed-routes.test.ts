import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_SECRET = "jwt-secret-jwt-secret-jwt-secret-jwt-secret";
  process.env.JWT_REFRESH_SECRET = "refresh-secret-refresh-secret-refresh-secret";
  process.env.COOKIE_SECRET = "cookie-secret-cookie-secret-cookie-secret";
  process.env.AUTH_TOKEN_SECRET = "auth-token-secret-auth-token-secret";
  process.env.ENCRYPTION_KEY = "encryption-key-encryption-key-32";
});

vi.mock("../../src/lib/pgboss.js", () => {
  const pgboss = {
    createQueue: vi.fn(async () => {}),
    insert: vi.fn(async () => ["job-id"]),
    send: vi.fn(async () => "job-id"),
    on: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  return {
    pgboss,
    startPgBoss: vi.fn(async () => {}),
    stopPgBoss: vi.fn(async () => {}),
  };
});

vi.mock("../../src/shared/logdb/lookup-sync.js", () => ({
  syncApiKeyLookupToLogDbBestEffort: vi.fn(),
  syncEnvironmentLookupToLogDbBestEffort: vi.fn(),
  syncEnvironmentSdkConfigLookupToLogDbBestEffort: vi.fn(),
  syncProjectLookupToLogDbBestEffort: vi.fn(),
}));

import { apiKeyCache, type CachedProjectConfig } from "../../src/config/lrucashe.js";
import { pgboss } from "../../src/lib/pgboss.js";
import { IngestionService } from "../../src/modules/ingestion/service.js";
import { compileInitial } from "../../src/modules/projects/sdk-config/compiler.js";
import type { RemoteSdkConfigService } from "../../src/modules/projects/sdk-config/sdk-config.service.js";
import type { IngestRequest } from "../../src/modules/ingestion/types.js";

const TEST_API_KEY = "pulse_test_key_0123456789abcdef0123456789abcdef";

function seedApiKeyCache(): void {
  const keyHash = createHash("sha256").update(TEST_API_KEY).digest("hex");
  const cached: CachedProjectConfig = {
    id: "11111111-1111-1111-1111-111111111111",
    orgId: "22222222-2222-2222-2222-222222222222",
    name: "Test Project",
    // This credential scope must never replace metadata.environment.
    environment: "production",
    environmentId: "33333333-3333-3333-3333-333333333333",
    environmentName: "Production",
    rateLimitPerSecond: 1_000_000,
    rateLimitPerMinute: 1_000_000,
    rateLimitPerHour: null,
    allowedEventTypes: ["*"],
    permissions: ["ingest:write"],
    allowedEndpoints: ["*"],
    blockedEndpoints: [],
    allowedOrigins: [],
    allowedIps: [],
    allowedDomains: [],
    allowedSdks: [],
    isActive: true,
    apiKeyId: "44444444-4444-4444-4444-444444444444",
    planTier: "free",
    orgRateLimitPerSecond: 1_000_000,
    orgRateLimitPerMinute: 1_000_000,
  };
  apiKeyCache.set(keyHash, cached);
}

function createFakePool() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as import("pg").Pool;
}

function buildService(sdkConfigService?: RemoteSdkConfigService): IngestionService {
  const pool = createFakePool();
  const writer = {
    pool,
    resolveApiKey: vi.fn(async () => null),
    updateApiKeyLastUsed: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
  } as never;
  return new IngestionService(
    pool,
    writer,
    {
      maxBatchSize: 1000,
      defaultRateLimitPerSecond: 1_000_000,
      defaultRateLimitPerMinute: 1_000_000,
    },
    sdkConfigService,
  );
}

function request(events: unknown[], environment = "customer-prod"): IngestRequest {
  return {
    apiKey: TEST_API_KEY,
    events: events as IngestRequest["events"],
    metadata: { environment },
  };
}

describe("IngestionService typed routing and SDK environment", () => {
  let service: IngestionService | undefined;

  beforeAll(seedApiKeyCache);

  afterEach(async () => {
    if (service) await service.shutdown();
    service = undefined;
    vi.clearAllMocks();
  });

  it("rejects a mismatched event type on a typed route", async () => {
    service = buildService();
    await expect(service.ingestTyped(
      request([{ type: "request", requestId: "r1", url: "/x", method: "GET", statusCode: 200, latency: 5 }]),
      TEST_API_KEY,
      "error",
    )).rejects.toThrow("INVALID_EVENT_TYPE");
  });

  it("falls back to the API key environment only when SDK metadata is absent", async () => {
    service = buildService();
    const result = await service.ingestTyped(
      { apiKey: TEST_API_KEY, events: [{ type: "error", message: "boom" }] } as never,
      TEST_API_KEY,
      "error",
    );
    expect(result).toMatchObject({ success: true, accepted: 1, rejected: 0 });

    const insert = vi.mocked(pgboss.insert);
    const ingestCall = insert.mock.calls.find(([queue]) => queue === "ingest.error");
    const items = ingestCall?.[1] as Array<{ data: { metadata: { environment: string } } }>;
    expect(items[0]?.data.metadata.environment).toBe("production");

    await expect(service.ingestTyped(
      request([{ type: "error", message: "boom" }], "bad environment!"),
      TEST_API_KEY,
      "error",
    )).rejects.toThrow("INVALID_ENVIRONMENT");
  });

  it("normalizes and propagates the SDK value without substituting credential scope", async () => {
    service = buildService();
    const result = await service.ingestTyped(
      request([{ type: "error", message: "boom" }], "  Customer.Prod_1  "),
      TEST_API_KEY,
      "error",
    );
    expect(result).toMatchObject({ success: true, accepted: 1, rejected: 0 });

    const insert = vi.mocked(pgboss.insert);
    const ingestCall = insert.mock.calls.find(([queue]) => queue === "ingest.error");
    expect(ingestCall).toBeDefined();
    const items = ingestCall?.[1] as Array<{ data: { metadata: { environment: string } } }>;
    expect(items[0]?.data.metadata).toMatchObject({ environment: "Customer.Prod_1" });
    expect(items[0]?.data.metadata.environment).not.toBe("production");
  });

  it("accepts a matching type and rejects any foreign event in a typed batch", async () => {
    service = buildService();
    await expect(service.ingestTyped(
      request([
        { type: "log", level: "info", message: "ok" },
        { type: "metric", metricName: "m", metricType: "counter", value: 1 },
      ]),
      TEST_API_KEY,
      "log",
    )).rejects.toThrow("INVALID_EVENT_TYPE");
  });

  it("delegates SDK initialization to the one canonical config service", async () => {
    const config = compileInitial(
      { projectId: "11111111-1111-1111-1111-111111111111", environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const buildDelivery = vi.fn(async () => ({
      organizationId: "22222222-2222-2222-2222-222222222222",
      projectId: "11111111-1111-1111-1111-111111111111",
      environmentId: "33333333-3333-3333-3333-333333333333",
      revisionNo: 7,
      config,
      etag: `"cfg-${config.meta.configHash}"`,
      usedDefaultFallback: false,
    }));
    service = buildService({ buildDelivery } as unknown as RemoteSdkConfigService);

    const result = await service.initializeSdk(TEST_API_KEY);
    expect(result.config).toEqual(config);
    expect(result.revisionNo).toBe(7);
    expect(buildDelivery).toHaveBeenCalledOnce();
    expect(result.config).not.toHaveProperty("ingestUrl");
    expect(result.config).not.toHaveProperty("featureFlags");
    expect(result.config).not.toHaveProperty("samplingRules");
  });
});
