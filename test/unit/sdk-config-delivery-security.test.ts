import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const databaseQuery = vi.hoisted(() => vi.fn());
const redisLookupCacheMocks = vi.hoisted(() => ({
  getApiKeyMapping: vi.fn(),
  setApiKeyMapping: vi.fn(),
  getInitDelivery: vi.fn(),
  setInitDelivery: vi.fn(),
  isKeyNegativeCached: vi.fn(),
  setNegativeKey: vi.fn(),
  isIpJailed: vi.fn(),
  recordAuthFailure: vi.fn(),
  checkDeliveryRateLimit: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  pool: { query: databaseQuery },
}));
vi.mock("../../src/db/redis/lookup-cache.js", () => ({
  redisLookupCache: redisLookupCacheMocks,
}));

import { compileInitial } from "../../src/modules/projects/sdk-config/compiler.js";
import { registerSdkDeliveryRoutes } from "../../src/modules/projects/sdk-config/sdk-config.delivery.routes.js";
import type { RemoteSdkConfigService } from "../../src/modules/projects/sdk-config/sdk-config.service.js";
import type { ApiKeyMapping } from "../../src/modules/projects/sdk-config/delivery.js";

const API_KEY = `pv_live_${"a".repeat(24)}.${"b".repeat(64)}`;
const MAPPING: ApiKeyMapping = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  defaultEnvironmentId: "33333333-3333-4333-8333-333333333333",
  allowedEnvironmentIds: ["33333333-3333-4333-8333-333333333333"],
};

let app: FastifyInstance | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  redisLookupCacheMocks.getApiKeyMapping.mockResolvedValue(null);
  redisLookupCacheMocks.getInitDelivery.mockResolvedValue(null);
  redisLookupCacheMocks.isKeyNegativeCached.mockResolvedValue(false);
  redisLookupCacheMocks.isIpJailed.mockResolvedValue(false);
  redisLookupCacheMocks.recordAuthFailure.mockResolvedValue({ jailed: false, count: 1 });
  redisLookupCacheMocks.checkDeliveryRateLimit.mockResolvedValue({ allowed: true, remaining: 100, resetSeconds: 60 });

  databaseQuery.mockResolvedValue({
    rows: [{
      organization_id: MAPPING.organizationId,
      project_id: MAPPING.projectId,
      environment_id: MAPPING.defaultEnvironmentId,
      secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
      allowed_ips: [],
      allowed_endpoints: [],
    }],
    rowCount: 1,
  });
});

afterEach(async () => {
  await app?.close();
  app = null;
});

function createMockService() {
  const config = compileInitial(
    { projectId: MAPPING.projectId, environment: "production" },
    { ingestBaseUrl: "https://ingest.pulse.test" },
    "2026-01-01T00:00:00.000Z",
  );
  const buildDelivery = vi.fn(async () => ({
    ...MAPPING,
    environmentId: MAPPING.defaultEnvironmentId,
    revisionNo: 1,
    config,
    etag: '"test-etag"',
    usedDefaultFallback: false,
  }));
  return { buildDelivery } as unknown as RemoteSdkConfigService;
}

describe("Enterprise Security Hardening for /v1/init and /v1/sdk-config", () => {
  it("allows requests from an IP in the allowed CIDR range", async () => {
    databaseQuery.mockResolvedValueOnce({
      rows: [{
        organization_id: MAPPING.organizationId,
        project_id: MAPPING.projectId,
        environment_id: MAPPING.defaultEnvironmentId,
        secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
        allowed_ips: ["192.168.1.0/24"],
      }],
      rowCount: 1,
    });

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "x-forwarded-for": "192.168.1.42",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
  });

  it("blocks requests from an IP outside the allowed CIDR range with 403 Forbidden", async () => {
    databaseQuery.mockResolvedValueOnce({
      rows: [{
        organization_id: MAPPING.organizationId,
        project_id: MAPPING.projectId,
        environment_id: MAPPING.defaultEnvironmentId,
        secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
        allowed_ips: ["192.168.1.0/24"],
      }],
      rowCount: 1,
    });

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "x-forwarded-for": "10.0.0.99", // Outside 192.168.1.0/24
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    const json = res.json();
    expect(json.error.code).toBe("forbidden");
    expect(redisLookupCacheMocks.recordAuthFailure).toHaveBeenCalled();
  });

  it("rejects requests immediately if the client IP is jailed in Redis", async () => {
    redisLookupCacheMocks.isIpJailed.mockResolvedValueOnce(true);

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: { "x-api-key": API_KEY },
      payload: {},
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("900");
    const json = res.json();
    expect(json.error.code).toBe("ip_banned");
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("validates fresh HMAC-SHA256 signature and returns 200", async () => {
    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const now = Date.now();
    const payload = {};
    const bodyHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const canonical = `${now}:POST:/v1/init:${bodyHash}`;
    const signature = createHmac("sha256", API_KEY).update(canonical).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "x-pulse-timestamp": String(now),
        "x-pulse-signature": signature,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("rejects an expired timestamp with timestamp_expired error", async () => {
    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const expiredTimestamp = Date.now() - 400_000; // > 5 minutes ago
    const payload = {};
    const bodyHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const canonical = `${expiredTimestamp}:POST:/v1/init:${bodyHash}`;
    const signature = createHmac("sha256", API_KEY).update(canonical).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "x-pulse-timestamp": String(expiredTimestamp),
        "x-pulse-signature": signature,
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("timestamp_expired");
  });

  it("rejects an invalid/tampered HMAC signature", async () => {
    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const now = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "x-pulse-timestamp": String(now),
        "x-pulse-signature": "deadbeefcafebabe0123456789abcdef",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_signature");
  });

  it("blocks browser CORS attempts via checkBrowserOriginGuard", async () => {
    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "origin": "https://malicious-site.example.com",
        "sec-fetch-mode": "cors",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });

  it("enforces allowed_endpoints restrictions", async () => {
    databaseQuery.mockResolvedValueOnce({
      rows: [{
        organization_id: MAPPING.organizationId,
        project_id: MAPPING.projectId,
        environment_id: MAPPING.defaultEnvironmentId,
        secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
        allowed_endpoints: ["/v1/init"], // Only /v1/init allowed
      }],
      rowCount: 1,
    });

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, createMockService());
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/v1/sdk-config", // Not in allowed_endpoints!
      headers: { "x-api-key": API_KEY },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });
});
