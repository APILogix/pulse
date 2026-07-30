/**
 * RemoteSdkConfigService verification with an in-memory ConfigStore fake.
 *
 * Verifies the integration seams for the strict requirements:
 *  - init is atomic + idempotent and stores a full compiled snapshot (R1)
 *  - publish rejects protected/unknown before persisting; appends a revision (R8/R9/R11)
 *  - rollback APPENDS a new revision and never rewinds the pointer (R11)
 *  - management responses are EditableConfigView only, no compiled leak (R5/R6)
 *  - delivery resolves scope from the key mapping, not body identity (R10)
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  RemoteSdkConfigService,
  type AppendRevisionInput,
  type ConfigScope,
  type ConfigStore,
  type HeadRecord,
  type RevisionRecord,
} from "../../src/modules/projects/sdk-config/sdk-config.service.js";
import { SdkConfigError } from "../../src/modules/projects/sdk-config/errors.js";
import type { ApiKeyMapping } from "../../src/modules/projects/sdk-config/delivery.js";

/** Minimal append-only in-memory store keyed by environmentId. */
class InMemoryConfigStore implements ConfigStore {
  private heads = new Map<string, HeadRecord>();
  private revisions = new Map<string, RevisionRecord[]>();

  async loadCurrent(scope: ConfigScope) {
    const head = this.heads.get(scope.environmentId);
    if (!head) return null;
    const list = this.revisions.get(scope.environmentId) ?? [];
    const current = list.find((r) => r.revisionNo === head.currentRevisionNo)!;
    return { head: { ...head }, current };
  }

  async loadRevision(scope: ConfigScope, revisionNo: number) {
    const list = this.revisions.get(scope.environmentId) ?? [];
    return list.find((r) => r.revisionNo === revisionNo) ?? null;
  }

  async appendRevision(scope: ConfigScope, input: AppendRevisionInput) {
    const head = this.heads.get(scope.environmentId);
    if (!head) throw new Error("not initialized");
    const list = this.revisions.get(scope.environmentId)!;
    const revisionNo = head.currentRevisionNo + 1;
    const revision: RevisionRecord = {
      revisionNo,
      requestedConfig: input.requestedConfig,
      compiledSnapshot: input.compiledSnapshot,
      canonicalSha256: input.canonicalSha256,
      changeType: input.changeType,
      rolledBackToRevision: input.rolledBackToRevision,
    };
    list.push(revision);
    const newHead: HeadRecord = { currentRevisionNo: revisionNo, draftVersion: head.draftVersion };
    this.heads.set(scope.environmentId, newHead);
    return { head: { ...newHead }, revision };
  }

  async initialize(scope: ConfigScope, revision: RevisionRecord) {
    if (!this.heads.has(scope.environmentId)) {
      this.heads.set(scope.environmentId, { currentRevisionNo: revision.revisionNo, draftVersion: 0 });
      this.revisions.set(scope.environmentId, [revision]);
    }
    const head = this.heads.get(scope.environmentId)!;
    const list = this.revisions.get(scope.environmentId)!;
    const current = list.find((r) => r.revisionNo === head.currentRevisionNo)!;
    return { head: { ...head }, current };
  }

  async loadCompiledByEnvironment(_organizationId: string, environmentId: string) {
    const head = this.heads.get(environmentId);
    if (!head) return null;
    const list = this.revisions.get(environmentId) ?? [];
    const current = list.find((r) => r.revisionNo === head.currentRevisionNo)!;
    return { revisionNo: current.revisionNo, compiledSnapshot: current.compiledSnapshot };
  }

  // Test helpers
  revisionCount(environmentId: string): number {
    return (this.revisions.get(environmentId) ?? []).length;
  }
}

const SCOPE: ConfigScope = {
  organizationId: "org1",
  projectId: "proj_123",
  environmentId: "env_prod",
  environmentKey: "production",
};

let store: InMemoryConfigStore;
let service: RemoteSdkConfigService;

beforeEach(async () => {
  store = new InMemoryConfigStore();
  service = new RemoteSdkConfigService(store, {
    topology: { ingestBaseUrl: "https://ingest.pulse.test" },
    clock: () => "2026-01-01T00:00:00.000Z",
  });
  await service.initialize(SCOPE, "user1");
});

describe("initialize (R1 atomic + idempotent)", () => {
  it("creates exactly one revision-1 with a full compiled snapshot", async () => {
    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);
    const rev = await store.loadRevision(SCOPE, 1);
    expect(rev?.changeType).toBe("initial");
    expect(rev?.compiledSnapshot.schemaVersion).toBe(1);
    expect(Object.keys(rev?.compiledSnapshot.transport.routes ?? {})).toHaveLength(10);
    expect(rev?.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is idempotent (second init does not create a second revision)", async () => {
    await service.initialize(SCOPE, "user1");
    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);
  });
});

describe("getEditableView (R5/R6 no compiled leak)", () => {
  it("returns an editableConfigView with no protected fields", async () => {
    const view = await service.getEditableView(SCOPE);
    expect(view.type).toBe("editableConfigView");
    expect(view.editableConfig).not.toHaveProperty("sdk");
    expect(view.editableConfig).not.toHaveProperty("meta");
    expect(JSON.stringify(view).includes("ingest.pulse.test")).toBe(false);
  });
});

describe("publish (R8/R9/R11)", () => {
  it("rejects a protected route url write and appends no revision", async () => {
    await expect(
      service.publish(SCOPE, {
        method: "PUT",
        body: { editableConfig: { transport: { routes: { traces: { url: "https://evil" } } } } },
        actorId: "user1",
      }),
    ).rejects.toMatchObject({ code: "protected_field", statusCode: 422 });
    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);
  });

  it("rejects unknown fields and appends no revision", async () => {
    await expect(
      service.publish(SCOPE, { method: "PUT", body: { editableConfig: { nope: 1 } }, actorId: "user1" }),
    ).rejects.toBeInstanceOf(SdkConfigError);
    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);
  });

  it("appends a compiled revision for a valid change", async () => {
    const view = await service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: { features: { tracing: false }, sampling: { traces: 0.25 } } },
      actorId: "user1",
    });
    expect(view.revision.currentRevisionNo).toBe(2);
    expect((view.editableConfig as any).features.tracing).toBe(false);
    const rev = await store.loadRevision(SCOPE, 2);
    expect(rev?.compiledSnapshot.features.tracing).toBe(false);
    expect(rev?.compiledSnapshot.sampling.traces).toBe(0.25);
    expect(rev?.changeType).toBe("publish");
  });
});

describe("rollback (R11 append-only, never rewind)", () => {
  it("appends a new revision whose intent matches the target", async () => {
    // rev2: tracing false
    await service.publish(SCOPE, { method: "PUT", body: { editableConfig: { features: { tracing: false } } }, actorId: "u" });
    // rev3: tracing true
    await service.publish(SCOPE, { method: "PUT", body: { editableConfig: { features: { tracing: true } } }, actorId: "u" });
    expect(store.revisionCount(SCOPE.environmentId)).toBe(3);

    // rollback to rev2 -> appends rev4 (pointer advances, never rewinds)
    const view = await service.rollback(SCOPE, 2, "u");
    expect(view.revision.currentRevisionNo).toBe(4);
    expect(store.revisionCount(SCOPE.environmentId)).toBe(4);
    const rev4 = await store.loadRevision(SCOPE, 4);
    expect(rev4?.changeType).toBe("rollback");
    expect(rev4?.rolledBackToRevision).toBe(2);
    expect(rev4?.compiledSnapshot.features.tracing).toBe(false);
  });
});

describe("buildDelivery (R10 key-mapping resolution)", () => {
  const mapping: ApiKeyMapping = {
    organizationId: "org1",
    projectId: "proj_123",
    defaultEnvironmentId: "env_prod",
    allowedEnvironmentIds: ["env_prod"],
  };

  it("delivers the compiled snapshot resolved from the key, ignoring body identity", async () => {
    const result = await service.buildDelivery(mapping, { projectId: "spoofed", environmentId: "env_secret" });
    expect(result.projectId).toBe("proj_123");
    expect(result.environmentId).toBe("env_prod"); // ungranted hint -> default
    expect(result.usedDefaultFallback).toBe(true);
    expect(result.config.schemaVersion).toBe(1);
    expect(result.etag).toMatch(/^"cfg-[0-9a-f]{64}"$/);
  });

  it("returns 503 when no committed config exists for the environment", async () => {
    const emptyStore = new InMemoryConfigStore();
    const emptyService = new RemoteSdkConfigService(emptyStore, { topology: { ingestBaseUrl: "https://x" } });
    await expect(emptyService.buildDelivery(mapping, {})).rejects.toMatchObject({ statusCode: 503 });
  });
});
