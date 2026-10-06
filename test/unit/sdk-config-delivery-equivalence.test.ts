import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const databaseQuery = vi.hoisted(() => vi.fn());
const redisLookupCacheMocks = vi.hoisted(() => ({
  getApiKeyMapping: vi.fn(),
  setApiKeyMapping: vi.fn(),
  getInitDelivery: vi.fn(),
  setInitDelivery: vi.fn(),
}));
vi.mock("../../src/config/database.js", () => ({
  pool: { query: databaseQuery },
}));
vi.mock("../../src/db/redis/lookup-cache.js", () => ({
  redisLookupCache: redisLookupCacheMocks,
}));

import { compileInitial } from "../../src/modules/projects/sdk-config/compiler.js";
import { acceptEmptyJsonBodyAsObject } from "../../src/shared/http/empty-json-body.js";
import { registerSdkDeliveryRoutes } from "../../src/modules/projects/sdk-config/sdk-config.delivery.routes.js";
import type {
  DeliveryResult,
  RemoteSdkConfigService,
} from "../../src/modules/projects/sdk-config/sdk-config.service.js";
import type {
  ApiKeyMapping,
  DeliveryRequestHints,
} from "../../src/modules/projects/sdk-config/delivery.js";

const API_KEY = `pv_live_${"a".repeat(24)}.${"b".repeat(64)}`;
const PUBLIC_KEY = `pv_live_${"a".repeat(24)}`;
const MAPPING: ApiKeyMapping = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  defaultEnvironmentId: "33333333-3333-4333-8333-333333333333",
  allowedEnvironmentIds: ["33333333-3333-4333-8333-333333333333"],
};

let app: FastifyInstance | null = null;

beforeEach(() => {
  redisLookupCacheMocks.getApiKeyMapping.mockReset();
  redisLookupCacheMocks.setApiKeyMapping.mockReset();
  redisLookupCacheMocks.getInitDelivery.mockReset();
  redisLookupCacheMocks.setInitDelivery.mockReset();
  redisLookupCacheMocks.getApiKeyMapping.mockResolvedValue(null);
  redisLookupCacheMocks.getInitDelivery.mockResolvedValue(null);
  redisLookupCacheMocks.setApiKeyMapping.mockResolvedValue(undefined);
  redisLookupCacheMocks.setInitDelivery.mockResolvedValue(undefined);
  databaseQuery.mockReset();
  databaseQuery.mockResolvedValue({
    rows: [{
      organization_id: MAPPING.organizationId,
      project_id: MAPPING.projectId,
      environment_id: MAPPING.defaultEnvironmentId,
      secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
    }],
    rowCount: 1,
  });
});

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("/v1/init and /v1/sdk-config equivalence", () => {
  it("coalesces a cold start burst into one key query and one config build", async () => {
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
      etag: '"burst"',
      usedDefaultFallback: false,
    }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    databaseQuery.mockImplementation(async () => {
      await gate;
      return { rows: [{
        organization_id: MAPPING.organizationId,
        project_id: MAPPING.projectId,
        environment_id: MAPPING.defaultEnvironmentId,
        secret_hash: createHash("sha256").update(API_KEY).digest("hex"),
      }] };
    });
    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, { buildDelivery } as unknown as RemoteSdkConfigService);
    await app.ready();
    const requests = Promise.all(Array.from({ length: 64 }, () => app!.inject({
      method: "POST", url: "/v1/init", headers: { "x-api-key": API_KEY }, payload: {},
    })));
    await vi.waitFor(() => expect(databaseQuery).toHaveBeenCalledTimes(1));
    release();
    const replies = await requests;
    expect(replies.every(reply => reply.statusCode === 200)).toBe(true);
    expect(databaseQuery).toHaveBeenCalledTimes(1);
    expect(buildDelivery).toHaveBeenCalledTimes(1);
    expect(new Set(replies.map(reply => reply.json().requestId)).size).toBe(64);
  });
  it("returns one canonical effective document with identical revision/cache headers", async () => {
    const config = compileInitial(
      { projectId: MAPPING.projectId, environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const result: DeliveryResult = {
      organizationId: MAPPING.organizationId,
      projectId: MAPPING.projectId,
      environmentId: MAPPING.defaultEnvironmentId,
      revisionNo: 7,
      config,
      etag: `"cfg-${config.meta.configHash}"`,
      usedDefaultFallback: false,
    };
    const buildDelivery = vi.fn(async (
      _mapping: ApiKeyMapping,
      _hints: DeliveryRequestHints,
    ): Promise<DeliveryResult> => result);
    const canonical = { buildDelivery } as unknown as RemoteSdkConfigService;

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, canonical);
    await app.ready();

    const headers = { "x-api-key": API_KEY };
    const payload = {
      schemaVersion: 1,
      projectId: "spoofed-project",
      environment: "spoofed-env",
      metadata: {
        projectId: MAPPING.projectId,
        environment: "production",
      },
    };
    const init = await app.inject({ method: "POST", url: "/v1/init", headers, payload });
    const configDelivery = await app.inject({ method: "POST", url: "/v1/sdk-config", headers, payload });

    expect(init.statusCode).toBe(200);
    expect(configDelivery.statusCode).toBe(200);

    const initJson = init.json();
    expect(initJson.success).toBe(true);
    expect(initJson.projectId).toBe(MAPPING.projectId);
    expect(initJson.organizationId).toBe(MAPPING.organizationId);
    expect(initJson.environmentId).toBe(MAPPING.defaultEnvironmentId);
    expect(initJson.environment).toBe("production");
    expect(initJson.release).toBe("1.0.0");
    expect(initJson.configRevision).toBe(7);
    expect(initJson.configHash).toBe(config.meta.configHash);
    expect(initJson.plan).toBe("enterprise");
    expect(initJson.config).toEqual(config);
    expect(initJson.ingestion).toBeDefined();
    expect(initJson.requestId).toBeDefined();

    // Verify config is NOT duplicated in top-level schema fields, data, or remoteConfig
    expect(initJson.data).toBeUndefined();
    expect(initJson.remoteConfig).toBeUndefined();
    expect(initJson.schemaVersion).toBeUndefined();
    expect(initJson.features).toBeUndefined();
    expect(initJson.sampling).toBeUndefined();
    expect(initJson.transport).toBeUndefined();
    expect(initJson.limits).toBeUndefined();
    expect(initJson.privacy).toBeUndefined();
    expect(initJson.runtime).toBeUndefined();
    expect(initJson.entitlements).toBeUndefined();
    expect(initJson.killswitches).toBeUndefined();
    expect(initJson.instrumentation).toBeUndefined();

    const configJson = configDelivery.json();
    expect(configJson.success).toBe(true);
    expect(configJson.projectId).toBe(MAPPING.projectId);
    expect(configJson.organizationId).toBe(MAPPING.organizationId);
    expect(configJson.environmentId).toBe(MAPPING.defaultEnvironmentId);
    expect(configJson.environment).toBe("production");
    expect(configJson.release).toBe("1.0.0");
    expect(configJson.configRevision).toBe(7);
    expect(configJson.configHash).toBe(config.meta.configHash);
    expect(configJson.plan).toBe("enterprise");
    expect(configJson.config).toEqual(config);
    expect(configJson.ingestion).toBeDefined();
    expect(configJson.requestId).toBeDefined();

    // Verify config is NOT duplicated in top-level schema fields, data, or remoteConfig
    expect(configJson.data).toBeUndefined();
    expect(configJson.remoteConfig).toBeUndefined();
    expect(configJson.schemaVersion).toBeUndefined();
    expect(configJson.features).toBeUndefined();
    expect(configJson.sampling).toBeUndefined();
    expect(configJson.transport).toBeUndefined();

    for (const header of ["etag", "x-config-revision", "cache-control"] as const) {
      expect(configDelivery.headers[header]).toBe(init.headers[header]);
    }
    expect(init.headers.etag).toBe(result.etag);
    expect(init.headers["x-config-revision"]).toBe("7");
    expect(init.headers["cache-control"]).toBe("private, no-cache");

    expect(buildDelivery).toHaveBeenCalled();
    expect(redisLookupCacheMocks.setInitDelivery).toHaveBeenCalledWith(
      API_KEY,
      expect.any(String),
      result,
      60,
    );
    expect(JSON.stringify(config)).not.toContain("environment_id");
    expect(JSON.stringify(config)).not.toContain("configValue");
  }, 15000);

  it("serves warm SDK init from the composite Redis cache without rebuilding config", async () => {
    const config = compileInitial(
      { projectId: MAPPING.projectId, environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const cached: DeliveryResult = {
      organizationId: MAPPING.organizationId,
      projectId: MAPPING.projectId,
      environmentId: MAPPING.defaultEnvironmentId,
      revisionNo: 9,
      config,
      etag: `"cfg-${config.meta.configHash}"`,
      usedDefaultFallback: false,
    };
    redisLookupCacheMocks.getInitDelivery.mockResolvedValueOnce(cached);
    const buildDelivery = vi.fn(async (): Promise<DeliveryResult> => {
      throw new Error("should not rebuild cached init delivery");
    });

    app = Fastify({ logger: false });
    registerSdkDeliveryRoutes(app, { buildDelivery } as unknown as RemoteSdkConfigService);
    await app.ready();

    const init = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: { "x-api-key": API_KEY },
      payload: {
        schemaVersion: 1,
        metadata: {
          projectId: MAPPING.projectId,
          environment: "production",
        },
      },
    });

    expect(init.statusCode).toBe(200);
    expect(init.json()).toMatchObject({
      success: true,
      projectId: MAPPING.projectId,
      configRevision: 9,
      configHash: config.meta.configHash,
    });
    expect(buildDelivery).not.toHaveBeenCalled();
    expect(redisLookupCacheMocks.setInitDelivery).not.toHaveBeenCalled();
  }, 15000);

  it("accepts an empty JSON body on SDK config init", async () => {
    const config = compileInitial(
      { projectId: MAPPING.projectId, environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const buildDelivery = vi.fn(async (): Promise<DeliveryResult> => ({
      organizationId: MAPPING.organizationId,
      projectId: MAPPING.projectId,
      environmentId: MAPPING.defaultEnvironmentId,
      revisionNo: 8,
      config,
      etag: `"cfg-${config.meta.configHash}"`,
      usedDefaultFallback: false,
    }));

    app = Fastify({ logger: false });
    acceptEmptyJsonBodyAsObject(app);
    registerSdkDeliveryRoutes(app, { buildDelivery } as unknown as RemoteSdkConfigService);
    await app.ready();

    const init = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
      },
      payload: "",
    });

    expect(init.statusCode).toBe(200);
    const initJson = init.json();
    expect(initJson.success).toBe(true);
    expect(initJson.projectId).toBe(MAPPING.projectId);
    expect(initJson.config).toEqual(config);
    expect(buildDelivery).toHaveBeenCalledWith(MAPPING, {
      environmentId: MAPPING.defaultEnvironmentId,
    });
  }, 15000);
  it("returns 304 Not Modified when client sends matching If-None-Match ETag", async () => {
    const config = compileInitial(
      { projectId: MAPPING.projectId, environment: "production" },
      { ingestBaseUrl: "https://ingest.pulse.test" },
      "2026-01-01T00:00:00.000Z",
    );
    const result: DeliveryResult = {
      organizationId: MAPPING.organizationId,
      projectId: MAPPING.projectId,
      environmentId: MAPPING.defaultEnvironmentId,
      revisionNo: 9,
      config,
      etag: `"cfg-${config.meta.configHash}"`,
      usedDefaultFallback: false,
    };
    const buildDelivery = vi.fn(async (): Promise<DeliveryResult> => result);

    app = Fastify({ logger: false });
    acceptEmptyJsonBodyAsObject(app);
    registerSdkDeliveryRoutes(app, { buildDelivery } as unknown as RemoteSdkConfigService);
    await app.ready();

    // 1. Matching ETag on /v1/init
    const matchResponse = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "if-none-match": result.etag,
      },
      payload: {},
    });
    expect(matchResponse.statusCode).toBe(304);
    expect(matchResponse.body).toBe("");
    expect(matchResponse.headers.etag).toBe(result.etag);
    expect(matchResponse.headers["x-config-revision"]).toBe("9");

    // 2. Matching weak ETag on /v1/sdk-config
    const weakMatchResponse = await app.inject({
      method: "POST",
      url: "/v1/sdk-config",
      headers: {
        "x-api-key": API_KEY,
        "if-none-match": `W/${result.etag}`,
      },
      payload: {},
    });
    expect(weakMatchResponse.statusCode).toBe(304);
    expect(weakMatchResponse.body).toBe("");

    // 3. Stale ETag returns 200 with payload
    const staleResponse = await app.inject({
      method: "POST",
      url: "/v1/init",
      headers: {
        "x-api-key": API_KEY,
        "if-none-match": '"cfg-stale-hash"',
      },
      payload: {},
    });
    expect(staleResponse.statusCode).toBe(200);
    expect(staleResponse.json().success).toBe(true);
  }, 15000);
});
