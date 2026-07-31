import { beforeEach, describe, expect, it } from "vitest";

import type { ApiKeyMapping } from "../../src/modules/projects/sdk-config/delivery.js";
import { SdkConfigError } from "../../src/modules/projects/sdk-config/errors.js";
import {
  RemoteSdkConfigService,
  type AppendRevisionInput,
  type ConfigScope,
  type ConfigStore,
  type HeadRecord,
  type RevisionRecord,
} from "../../src/modules/projects/sdk-config/sdk-config.service.js";

class InMemoryConfigStore implements ConfigStore {
  private readonly heads = new Map<string, HeadRecord>();
  private readonly revisions = new Map<string, RevisionRecord[]>();
  private readonly environmentKeys = new Map<string, string>();

  async loadCurrent(scope: ConfigScope) {
    const head = this.heads.get(scope.environmentId);
    if (!head) return null;
    const current = (this.revisions.get(scope.environmentId) ?? []).find(
      (revision) => revision.revisionNo === head.currentRevisionNo,
    );
    if (!current) throw new Error("Corrupt test store head");
    return { head: { ...head }, current };
  }

  async loadRevision(scope: ConfigScope, revisionNo: number) {
    return (this.revisions.get(scope.environmentId) ?? []).find(
      (revision) => revision.revisionNo === revisionNo,
    ) ?? null;
  }

  async appendRevision(scope: ConfigScope, input: AppendRevisionInput) {
    const head = this.heads.get(scope.environmentId);
    const list = this.revisions.get(scope.environmentId);
    if (!head || !list) throw new Error("Test store is not initialized");
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
    const nextHead: HeadRecord = { currentRevisionNo: revisionNo, draftVersion: head.draftVersion };
    this.heads.set(scope.environmentId, nextHead);
    return { head: { ...nextHead }, revision };
  }

  async initialize(scope: ConfigScope, revision: RevisionRecord) {
    if (!this.heads.has(scope.environmentId)) {
      this.heads.set(scope.environmentId, { currentRevisionNo: revision.revisionNo, draftVersion: 0 });
      this.revisions.set(scope.environmentId, [revision]);
      this.environmentKeys.set(scope.environmentId, scope.environmentKey);
    }
    const loaded = await this.loadCurrent(scope);
    if (!loaded) throw new Error("Test store initialization failed");
    return loaded;
  }

  async loadCompiledByEnvironment(_organizationId: string, environmentId: string) {
    const head = this.heads.get(environmentId);
    const environment = this.environmentKeys.get(environmentId);
    if (!head || !environment) return null;
    const current = (this.revisions.get(environmentId) ?? []).find(
      (revision) => revision.revisionNo === head.currentRevisionNo,
    );
    if (!current) return null;
    return {
      revisionNo: current.revisionNo,
      compiledSnapshot: current.compiledSnapshot,
      environment,
    };
  }

  async loadCompiledBySdkMetadata(organizationId: string, projectId: string, environment: string) {
    for (const [environmentId, storedEnvironment] of this.environmentKeys) {
      if (storedEnvironment !== environment) continue;
      const head = this.heads.get(environmentId);
      const current = (this.revisions.get(environmentId) ?? []).find(
        (revision) => revision.revisionNo === head?.currentRevisionNo,
      );
      if (
        current?.compiledSnapshot.sdk.projectId === projectId &&
        current.compiledSnapshot.sdk.environment === environment &&
        organizationId === SCOPE.organizationId
      ) {
        return {
          revisionNo: current.revisionNo,
          environmentId,
          compiledSnapshot: current.compiledSnapshot,
        };
      }
    }
    return null;
  }

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
const MAPPING: ApiKeyMapping = {
  organizationId: SCOPE.organizationId,
  projectId: SCOPE.projectId,
  defaultEnvironmentId: SCOPE.environmentId,
  allowedEnvironmentIds: [SCOPE.environmentId],
};

let store: InMemoryConfigStore;
let service: RemoteSdkConfigService;

beforeEach(async () => {
  store = new InMemoryConfigStore();
  service = new RemoteSdkConfigService(store, {
    topology: { ingestBaseUrl: "https://ingest.pulse.test" },
    // Deliberately fixed: the service must still issue a fresh timestamp per revision.
    clock: () => "2026-01-01T00:00:00.000Z",
  });
  await service.initialize(SCOPE, "user1");
});

describe("canonical initialization", () => {
  it("atomically creates one complete revision and is idempotent", async () => {
    await service.initialize(SCOPE, "user1");
    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);

    const revision = await store.loadRevision(SCOPE, 1);
    expect(revision).toMatchObject({ revisionNo: 1, requestedConfig: {}, changeType: "initial" });
    expect(revision?.compiledSnapshot).toMatchObject({
      schemaVersion: 1,
      sdk: { projectId: SCOPE.projectId, environment: SCOPE.environmentKey, release: "1.0.0" },
      meta: { generatedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(Object.keys(revision?.compiledSnapshot ?? {})).toHaveLength(12);
    expect(Object.keys(revision?.compiledSnapshot.transport.routes ?? {})).toHaveLength(10);
    expect(revision?.canonicalSha256).toBe(revision?.compiledSnapshot.meta.configHash);
  });

  it("returns only the editable management projection", async () => {
    const view = await service.getEditableView(SCOPE);
    const serialized = JSON.stringify(view);
    expect(view).toMatchObject({
      type: "editableConfigView",
      scope: SCOPE,
      revision: { currentRevisionNo: 1 },
    });
    expect(view.editableConfig).not.toHaveProperty("schemaVersion");
    expect(view.editableConfig).not.toHaveProperty("sdk");
    expect(view.editableConfig).not.toHaveProperty("meta");
    expect(view.editableConfig).not.toHaveProperty("entitlements");
    expect(serialized).not.toContain("ingest.pulse.test");
  });
});

describe("canonical publishing", () => {
  it("rejects protected, legacy, unknown, and arbitrary compiled writes before persistence", async () => {
    await expect(service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: { transport: { routes: { traces: { url: "https://evil.test" } } } } },
      actorId: "user1",
    })).rejects.toMatchObject({ code: "protected_field", statusCode: 422 });

    await expect(service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: { sampling: { routeOverrides: true } } },
      actorId: "user1",
    })).rejects.toMatchObject({ code: "unknown_field", statusCode: 422 });

    await expect(service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: {}, compiledSnapshot: { schemaVersion: 1 } },
      actorId: "user1",
    })).rejects.toMatchObject({ code: "envelope_invalid", statusCode: 422 });

    expect(store.revisionCount(SCOPE.environmentId)).toBe(1);
  });

  it("appends a complete revision with a fresh generatedAt and hash", async () => {
    const initial = await store.loadRevision(SCOPE, 1);
    const view = await service.publish(SCOPE, {
      method: "PUT",
      body: {
        editableConfig: {
          features: { tracing: false },
          sampling: { traces: 0.25 },
          limits: { maxMemoryMb: "auto" },
        },
      },
      actorId: "user1",
    });

    const published = await store.loadRevision(SCOPE, 2);
    expect(view.revision.currentRevisionNo).toBe(2);
    expect(published).toMatchObject({
      revisionNo: 2,
      requestedConfig: {
        features: { tracing: false },
        sampling: { traces: 0.25 },
        limits: { maxMemoryMb: "auto" },
      },
      changeType: "publish",
      rolledBackToRevision: null,
    });
    expect(published?.compiledSnapshot.features.tracing).toBe(false);
    expect(published?.compiledSnapshot.sampling.traces).toBe(0.25);
    expect(published?.compiledSnapshot.meta.generatedAt).toBe("2026-01-01T00:00:00.001Z");
    expect(published?.compiledSnapshot.meta.generatedAt).not.toBe(initial?.compiledSnapshot.meta.generatedAt);
    expect(published?.canonicalSha256).toBe(published?.compiledSnapshot.meta.configHash);
    expect(published?.canonicalSha256).not.toBe(initial?.canonicalSha256);
  });
});

describe("append-only rollback", () => {
  it("recompiles historical editable intent into a new revision with a fresh timestamp and hash", async () => {
    await service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: { features: { tracing: false } } },
      actorId: "user1",
    });
    await service.publish(SCOPE, {
      method: "PUT",
      body: { editableConfig: { features: { tracing: true } } },
      actorId: "user1",
    });
    const target = await store.loadRevision(SCOPE, 2);

    const view = await service.rollback(SCOPE, 2, "user1");
    const rollback = await store.loadRevision(SCOPE, 4);
    expect(view.revision.currentRevisionNo).toBe(4);
    expect(store.revisionCount(SCOPE.environmentId)).toBe(4);
    expect(rollback).toMatchObject({
      revisionNo: 4,
      requestedConfig: target?.requestedConfig,
      changeType: "rollback",
      rolledBackToRevision: 2,
    });
    expect(rollback?.compiledSnapshot.features.tracing).toBe(false);
    expect(rollback?.compiledSnapshot.meta.generatedAt).toBe("2026-01-01T00:00:00.003Z");
    expect(rollback?.compiledSnapshot.meta.generatedAt).not.toBe(target?.compiledSnapshot.meta.generatedAt);
    expect(rollback?.canonicalSha256).toBe(rollback?.compiledSnapshot.meta.configHash);
    expect(rollback?.canonicalSha256).not.toBe(target?.canonicalSha256);
  });
});

describe("direct delivery", () => {
  it("returns the stored effective document with identity resolved from SDK metadata plus API-key org", async () => {
    const stored = await store.loadRevision(SCOPE, 1);
    const result = await service.buildDelivery(MAPPING, {
      projectId: SCOPE.projectId,
      environment: SCOPE.environmentKey,
      environmentId: "env_secret",
    });
    expect(result).toMatchObject({
      organizationId: SCOPE.organizationId,
      projectId: SCOPE.projectId,
      environmentId: SCOPE.environmentId,
      revisionNo: 1,
      usedDefaultFallback: false,
    });
    expect(result.config).toEqual(stored?.compiledSnapshot);
    expect(result.etag).toBe(`"cfg-${stored?.canonicalSha256}"`);
  });

  it("fails closed when no committed snapshot exists", async () => {
    const emptyService = new RemoteSdkConfigService(new InMemoryConfigStore(), {
      topology: { ingestBaseUrl: "https://ingest.pulse.test" },
    });
    await expect(emptyService.buildDelivery(MAPPING, {})).rejects.toBeInstanceOf(SdkConfigError);
    await expect(emptyService.buildDelivery(MAPPING, {})).rejects.toMatchObject({ statusCode: 503 });
  });
});
