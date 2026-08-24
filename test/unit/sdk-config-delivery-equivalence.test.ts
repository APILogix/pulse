import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const databaseQuery = vi.hoisted(() => vi.fn());
vi.mock("../../src/config/database.js", () => ({
  pool: { query: databaseQuery },
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
    expect(initJson.environment).toBe("production");
    expect(initJson.release).toBe("1.0.0");
    expect(initJson.config).toEqual(config);
    expect(initJson.data).toEqual(config);
    expect(initJson.schemaVersion).toBe(1);
    expect(initJson.features).toEqual(config.features);
    expect(initJson.transport.routes).toEqual(config.transport.routes);

    const configJson = configDelivery.json();
    expect(configJson.success).toBe(true);
    expect(configJson.projectId).toBe(MAPPING.projectId);
    expect(configJson.config).toEqual(config);
    expect(configJson.features).toEqual(config.features);

    for (const header of ["etag", "x-config-revision", "cache-control"] as const) {
      expect(configDelivery.headers[header]).toBe(init.headers[header]);
    }
    expect(init.headers.etag).toBe(result.etag);
    expect(init.headers["x-config-revision"]).toBe("7");
    expect(init.headers["cache-control"]).toBe("private, no-cache");

    expect(buildDelivery).toHaveBeenCalled();
    expect(JSON.stringify(config)).not.toContain("environment_id");
    expect(JSON.stringify(config)).not.toContain("configValue");
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
});
