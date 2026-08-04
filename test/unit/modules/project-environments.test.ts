import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("../../../src/config/database.js", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

// The environment service now syncs best-effort Log DB lookup snapshots, which
// transitively imports the Log DB manager. Stub it to keep this test hermetic.
vi.mock("../../../src/config/log-database.js", () => ({
  logDB: { queryWithRetry: vi.fn() },
}));

import {
  CreateEnvironmentBodySchema,
  EnvironmentType,
  UpdateEnvironmentBodySchema,
} from "../../../src/modules/projects/environments/environment.types.js";
import { EnvironmentRepository, type EnvRow } from "../../../src/modules/projects/environments/environment.repository.js";
import { EnvironmentService } from "../../../src/modules/projects/environments/environment.service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const environmentId = "33333333-3333-4333-8333-333333333333";

const row = (overrides: Partial<EnvRow> = {}): EnvRow => ({
  id: environmentId,
  project_id: projectId,
  organization_id: orgId,
  name: "Staging",
  slug: "staging",
  type: EnvironmentType.STAGING,
  description: "Pre-production telemetry",
  color: "#D97706",
  is_default: false,
  is_active: true,
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  deleted_at: null,
  ...overrides,
});

function repositoryWith(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  const db = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { repository: new EnvironmentRepository(db), client };
}

describe("environment request validation", () => {
  it("accepts every canonical pre-release type", () => {
    for (const type of [
      EnvironmentType.PRE_PRODUCTION,
      EnvironmentType.PRE_STAGING,
      EnvironmentType.PRE_DEPLOYMENT,
    ]) {
      expect(CreateEnvironmentBodySchema.parse({
        name: "Candidate", slug: "candidate", type, color: "#2563EB",
      }).type).toBe(type);
    }
  });

  it("rejects invalid slugs, colors, and removed policy fields", () => {
    expect(() => CreateEnvironmentBodySchema.parse({
      name: "Bad", slug: "Bad slug", type: EnvironmentType.CUSTOM, color: "blue",
    })).toThrow();
    expect(() => CreateEnvironmentBodySchema.parse({
      name: "Legacy", slug: "legacy", type: EnvironmentType.CUSTOM,
      color: "#123456", rateLimitPerSecond: 10,
    })).toThrow();
  });

  it("requires a default environment to remain active", () => {
    expect(() => UpdateEnvironmentBodySchema.parse({ isDefault: true, isActive: false })).toThrow();
  });
});

describe("environment repository lifecycle", () => {
  it("sets a default atomically and clears the prior default", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: null };
      if (sql.includes("SELECT") && sql.includes("FOR UPDATE")) return { rows: [row()], rowCount: 1 };
      if (sql.includes("RETURNING")) return { rows: [row({ is_default: true })], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { repository } = repositoryWith(query);
    const result = await repository.setDefaultEnvironment(projectId, environmentId);
    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("SET is_default = FALSE");
    expect(sql).toContain("is_default = $");
    expect(result.isDefault).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rejects deactivating the last active environment and rolls back", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: null };
      if (sql.includes("SELECT") && sql.includes("id = $2")) return { rows: [row()], rowCount: 1 };
      if (sql.includes("SELECT id FROM") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: environmentId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { repository } = repositoryWith(query);
    await expect(repository.deactivateEnvironment(projectId, environmentId))
      .rejects.toMatchObject({ code: "LAST_ACTIVE_ENVIRONMENT" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("rejects deleting the default until a replacement is selected", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["BEGIN", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: null };
      if (sql.includes("SELECT") && sql.includes("id = $2")) {
        return { rows: [row({ is_default: true })], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: environmentId }, { id: "other" }], rowCount: 2 };
      }
      if (sql.includes("id <> $2") && sql.includes("is_default")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const { repository } = repositoryWith(query);
    await expect(repository.deleteEnvironment(projectId, environmentId))
      .rejects.toMatchObject({ code: "DEFAULT_ENVIRONMENT_REQUIRED" });
  });

  it("restores a soft-deleted environment as active and non-default", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [], rowCount: null };
      if (sql.includes("SELECT") && sql.includes("FOR UPDATE")) {
        return { rows: [row({ deleted_at: new Date(), is_active: false })], rowCount: 1 };
      }
      if (sql.includes("RETURNING")) {
        return { rows: [row({ deleted_at: null, is_active: true, is_default: false })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { repository } = repositoryWith(query);
    const restored = await repository.restoreEnvironment(projectId, environmentId);
    expect(restored.deletedAt).toBeNull();
    expect(restored.isActive).toBe(true);
    expect(restored.isDefault).toBe(false);
  });
});

describe("environment service permissions and billing", () => {
  const body = {
    name: "Preview", slug: "preview-two", type: EnvironmentType.PREVIEW,
    color: "#DB2777", description: null,
  };
  const meta = {
    actorUserId: "44444444-4444-4444-8444-444444444444", actorEmail: null,
    actorSessionId: null, actorIp: "127.0.0.1", actorUserAgent: "vitest",
    requestId: "55555555-5555-4555-8555-555555555555", httpMethod: "POST", endpoint: "/environments",
  };

  // Every environment creation now runs inside the project transaction and
  // provisions its SDK configuration via the injected provisioner.
  function serviceWith(environments: any) {
    const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const repository = { withTransaction: vi.fn(async (work: any) => work(client)) };
    const sdkConfigProvisioner = { provisionInitial: vi.fn().mockResolvedValue({ headId: "h", revisionId: "r", configHash: "x" }) };
    const service = new EnvironmentService(repository as any, { error: vi.fn() } as any, {} as any,
      {} as any, {} as any, {} as any, environments as any, {} as any, sdkConfigProvisioner as any);
    return { service, client, repository, sdkConfigProvisioner };
  }

  it("authorizes admin access and does not bill predefined environment types as custom", async () => {
    const environments = { createEnvironment: vi.fn().mockResolvedValue({ ...row(), type: body.type }) };
    const { service, client, sdkConfigProvisioner } = serviceWith(environments);
    vi.spyOn(service, "requireProjectAccess").mockResolvedValue({} as any);
    const limit = vi.spyOn(service, "enforceProjectModuleLimit").mockResolvedValue({} as any);
    vi.spyOn(service, "audit").mockResolvedValue(undefined);
    await service.createEnvironment(orgId, projectId, meta.actorUserId, body, meta);
    expect(service.requireProjectAccess).toHaveBeenCalledWith(orgId, projectId, meta.actorUserId, "admin");
    expect(limit).not.toHaveBeenCalled();
    // SDK config is provisioned in the same transaction as the environment.
    expect(environments.createEnvironment).toHaveBeenCalledWith(expect.any(Object), client);
    expect(sdkConfigProvisioner.provisionInitial).toHaveBeenCalledTimes(1);
  });

  it("applies the environment entitlement only to custom types", async () => {
    const environments = { createEnvironment: vi.fn().mockResolvedValue({ ...row(), type: EnvironmentType.CUSTOM }) };
    const { service } = serviceWith(environments);
    vi.spyOn(service, "requireProjectAccess").mockResolvedValue({} as any);
    const limit = vi.spyOn(service, "enforceProjectModuleLimit").mockResolvedValue({} as any);
    vi.spyOn(service, "audit").mockResolvedValue(undefined);
    await service.createEnvironment(orgId, projectId, meta.actorUserId, {
      ...body, type: EnvironmentType.CUSTOM,
    }, meta);
    expect(limit).toHaveBeenCalledWith(orgId, "environment");
  });

  it("does not persist when project-admin authorization fails", async () => {
    const environments = { createEnvironment: vi.fn() };
    const { service, sdkConfigProvisioner } = serviceWith(environments);
    vi.spyOn(service, "requireProjectAccess").mockRejectedValue(
      Object.assign(new Error("Insufficient project role"), { code: "INSUFFICIENT_PERMISSIONS" }),
    );
    await expect(service.createEnvironment(orgId, projectId, meta.actorUserId, body, meta))
      .rejects.toMatchObject({ code: "INSUFFICIENT_PERMISSIONS" });
    expect(environments.createEnvironment).not.toHaveBeenCalled();
    expect(sdkConfigProvisioner.provisionInitial).not.toHaveBeenCalled();
  });
});