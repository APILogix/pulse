import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { EnvironmentType } from "../../../src/modules/projects/environments/environment.types.js";

vi.mock("../../../src/shared/middleware/auth.js", () => ({
  authenticate: async (request: { user?: unknown }) => {
    request.user = {
      id: "44444444-4444-4444-8444-444444444444",
      email: "admin@example.test",
      sessionId: "session-1",
    };
  },
}));

import { projectEnvironmentRoutes } from "../../../src/modules/projects/environments/environment.routes.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const environmentId = "33333333-3333-4333-8333-333333333333";
const base = `/organizations/${orgId}/projects/${projectId}/environments`;
const environment = {
  id: environmentId,
  projectId,
  orgId,
  name: "Preview",
  slug: "preview",
  type: EnvironmentType.PREVIEW,
  description: "Preview telemetry",
  color: "#DB2777",
  isDefault: false,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function makeApp() {
  const service = {
    listEnvironments: vi.fn().mockResolvedValue([environment]),
    getEnvironment: vi.fn().mockResolvedValue(environment),
    createEnvironment: vi.fn().mockResolvedValue(environment),
    updateEnvironment: vi.fn().mockResolvedValue(environment),
    deleteEnvironment: vi.fn().mockResolvedValue(undefined),
    restoreEnvironment: vi.fn().mockResolvedValue(environment),
    setDefaultEnvironment: vi.fn().mockResolvedValue({ ...environment, isDefault: true }),
    deactivateEnvironment: vi.fn().mockResolvedValue({ ...environment, isActive: false }),
    getProject: vi.fn().mockResolvedValue({ id: projectId }),
  };
  app = Fastify({ logger: false });
  app.decorate("projects", { service } as any);
  app.decorate("organization", { sdkConfigService: {} } as any);
  await app.register(projectEnvironmentRoutes, { prefix: "/organizations/:orgId/projects" });
  await app.ready();
  return { app, service };
}

describe("project environment API contract", () => {
  it("passes includeDeleted through the list endpoint", async () => {
    const context = await makeApp();
    const response = await context.app.inject({ method: "GET", url: `${base}?includeDeleted=true` });
    expect(response.statusCode).toBe(200);
    expect(context.service.listEnvironments).toHaveBeenCalledWith(
      orgId, projectId, "44444444-4444-4444-8444-444444444444", true,
    );
    expect(response.json().data[0].type).toBe(EnvironmentType.PREVIEW);
  });

  it("accepts only the simplified create contract", async () => {
    const context = await makeApp();
    const response = await context.app.inject({
      method: "POST",
      url: base,
      payload: {
        name: "Pre-deployment",
        slug: "pre-deployment",
        type: EnvironmentType.PRE_DEPLOYMENT,
        description: "Deployment candidate telemetry",
        color: "#0891B2",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(context.service.createEnvironment).toHaveBeenCalledWith(
      orgId,
      projectId,
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ slug: "pre-deployment", type: EnvironmentType.PRE_DEPLOYMENT }),
      expect.objectContaining({ actorUserId: "44444444-4444-4444-8444-444444444444" }),
    );

    const legacy = await context.app.inject({
      method: "POST",
      url: base,
      payload: {
        name: "Legacy", slug: "legacy", type: EnvironmentType.CUSTOM,
        color: "#64748B", rateLimitPerSecond: 100,
      },
    });
    expect(legacy.statusCode).toBe(422);
    expect(context.service.createEnvironment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["restore", "restoreEnvironment"],
    ["set-default", "setDefaultEnvironment"],
    ["deactivate", "deactivateEnvironment"],
  ] as const)("exposes the %s lifecycle action", async (action, method) => {
    const context = await makeApp();
    const response = await context.app.inject({
      method: "POST",
      url: `${base}/${environmentId}/${action}`,
    });
    expect(response.statusCode).toBe(200);
    expect(context.service[method]).toHaveBeenCalledWith(
      orgId,
      projectId,
      environmentId,
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ httpMethod: "POST" }),
    );
  });
});