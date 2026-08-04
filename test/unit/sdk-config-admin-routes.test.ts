import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../../src/shared/middleware/auth.js", () => ({
  authenticate: async (request: { user?: unknown }) => {
    request.user = {
      id: "44444444-4444-4444-8444-444444444444",
      email: "admin@example.test",
      sessionId: "session-1",
    };
  },
}));

import { registerSdkConfigRoutes } from "../../src/modules/organization/sdk-config/sdk-config.routes.js";
import type { SdkConfigService } from "../../src/modules/organization/sdk-config/sdk-config.service.js";
import { applyEditableMutation } from "../../src/modules/projects/sdk-config/editable-view.js";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONFIG_ID = "22222222-2222-4222-8222-222222222222";
const URL = `/organizations/${ORG_ID}/sdk-configs/${CONFIG_ID}`;

let app: FastifyInstance | null = null;
let updateConfig: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  updateConfig = vi.fn(async (
    _meta: unknown,
    _orgId: string,
    _configId: string,
    input: { editableConfig: Record<string, unknown>; changeSummary?: string },
  ) => {
    const requestedConfig = applyEditableMutation({
      currentIntent: {},
      method: "PUT",
      body: { editableConfig: input.editableConfig },
    });
    return {
      id: CONFIG_ID,
      orgId: ORG_ID,
      revision: 2,
      compiledSnapshot: null,
      requestedConfig,
    };
  });
  const service = {
    updateConfig,
    listConfigs: vi.fn(),
    resolveForSdk: vi.fn(),
    getConfig: vi.fn(),
    rollbackConfig: vi.fn(),
    listVersions: vi.fn(),
    getVersion: vi.fn(),
  } as unknown as SdkConfigService;

  app = Fastify({ logger: false });
  await app.register(async (scope) => {
    registerSdkConfigRoutes(scope, service);
  }, { prefix: "/organizations" });
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  app = null;
});

describe("admin SDK config breaking contract", () => {
  it.each([
    ["unknown envelope key", { editableConfig: {}, legacy: true }],
    ["caller-supplied compiled snapshot", { editableConfig: {}, compiledSnapshot: { schemaVersion: 1 } }],
  ])("maps %s to a structured 422 before mutation", async (_label, payload) => {
    const response = await app!.inject({ method: "PATCH", url: URL, payload });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid SDK configuration request",
      },
    });
    expect(response.json().error.details).toBeDefined();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("rejects a compiler-owned transport route URL with 422", async () => {
    const response = await app!.inject({
      method: "PATCH",
      url: URL,
      payload: {
        editableConfig: {
          transport: {
            routes: {
              traces: { url: "https://evil.example/api/v1/traces" },
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "protected_field" },
    });
  });

  it("does not let an unknown empty nested object bypass mutation validation", async () => {
    const response = await app!.inject({
      method: "PATCH",
      url: URL,
      payload: { editableConfig: { sampling: { routeOverrides: {} } } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "unknown_field" },
    });
    expect(updateConfig).toHaveBeenCalledOnce();
  });

  it("accepts editable intent only and forwards no compiled document", async () => {
    const editableConfig = {
      features: { tracing: false },
      limits: { maxMemoryMb: "auto" },
      transport: { keepAlive: false },
    };
    const response = await app!.inject({
      method: "PATCH",
      url: URL,
      payload: { editableConfig, changeSummary: "reduce tracing" },
    });

    expect(response.statusCode).toBe(200);
    expect(updateConfig).toHaveBeenCalledOnce();
    expect(updateConfig.mock.calls[0]?.[3]).toEqual({
      editableConfig,
      changeSummary: "reduce tracing",
    });
    expect(JSON.stringify(updateConfig.mock.calls[0]?.[3])).not.toContain("compiledSnapshot");
    expect(JSON.stringify(updateConfig.mock.calls[0]?.[3])).not.toContain("configValue");
  });

  it("accepts a legacy full configValue envelope and forwards only editable intent", async () => {
    const response = await app!.inject({
      method: "PATCH",
      url: URL,
      payload: {
        schemaVersion: 1,
        configValue: {
          schemaVersion: 1,
          sdk: {
            projectId: "project-owned-by-server",
            environment: "production",
            release: "9.9.9",
          },
          features: { tracing: false, errors: true },
          transport: {
            routes: {
              errors: {
                url: "https://attacker.example/api/v1/errors",
                batchSize: 10,
              },
            },
          },
          meta: {
            generatedAt: "2026-01-01T00:00:00.000Z",
            generatedBy: "client",
            configHash: "bad",
          },
        },
        changeSummary: "legacy UI update",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateConfig).toHaveBeenCalledOnce();
    expect(updateConfig.mock.calls[0]?.[3]).toEqual({
      editableConfig: {
        features: { tracing: false, errors: true },
        transport: { routes: { errors: { batchSize: 10 } } },
      },
      changeSummary: "legacy UI update",
    });
    expect(JSON.stringify(updateConfig.mock.calls[0]?.[3])).not.toContain("project-owned-by-server");
    expect(JSON.stringify(updateConfig.mock.calls[0]?.[3])).not.toContain("attacker.example");
    expect(JSON.stringify(updateConfig.mock.calls[0]?.[3])).not.toContain("configHash");
  });
});
