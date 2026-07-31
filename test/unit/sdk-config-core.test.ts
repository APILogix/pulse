import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalJson, computeConfigHash, hashValue } from "../../src/modules/projects/sdk-config/canonical.js";
import { compile, compileInitial, type CompileInput } from "../../src/modules/projects/sdk-config/compiler.js";
import {
  assertSupportedSchemaVersion,
  buildDeliverySnapshot,
  resolveDeliveryScope,
  selectDeliveryEnvironment,
  type ApiKeyMapping,
} from "../../src/modules/projects/sdk-config/delivery.js";
import { classifyLeafPath } from "../../src/modules/projects/sdk-config/editable-allowlist.js";
import {
  applyEditableMutation,
  extractEditableConfig,
  projectEditableView,
} from "../../src/modules/projects/sdk-config/editable-view.js";
import { SdkConfigError } from "../../src/modules/projects/sdk-config/errors.js";
import {
  FEATURE_KEYS,
  INSTRUMENTATION_KEYS,
  KILLSWITCH_KEYS,
  PII_DETECTION_KEYS,
  REQUIRED_SECTIONS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  SCHEMA_VERSION,
  TOP_LEVEL_KEYS,
  type SchemaV1Config,
} from "../../src/modules/projects/sdk-config/schema-v1.js";
import { deepClone } from "../../src/modules/projects/sdk-config/traversal.js";
import { BOUNDS, validateEditableLeaf, validateSchemaV1 } from "../../src/modules/projects/sdk-config/validator.js";

const TOPOLOGY = { ingestBaseUrl: "https://ingest.pulse.test/api" };
const IDENTITY = { projectId: "proj_123", environment: "production" };
const AT = "2026-01-01T00:00:00.000Z";
const EXACT_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "sdk",
  "features",
  "sampling",
  "instrumentation",
  "privacy",
  "limits",
  "killswitches",
  "transport",
  "runtime",
  "meta",
  "entitlements",
] as const;
const EXPECTED_SNAPSHOT = JSON.parse(
  readFileSync(new URL("../fixtures/sdk-config-v1.snapshot.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function baseInput(requestedIntent: Record<string, unknown> = {}, generatedAt = AT): CompileInput {
  return { identity: IDENTITY, topology: TOPOLOGY, requestedIntent, generatedAt };
}

function expectSdkError(action: () => unknown): SdkConfigError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SdkConfigError);
    return error as SdkConfigError;
  }
  throw new Error("Expected SdkConfigError");
}

function snapshotWithoutHash(config: SchemaV1Config): Record<string, unknown> {
  return {
    ...deepClone(config),
    meta: { ...config.meta, configHash: "<sha256>" },
  };
}

describe("schema-v1 closed contract", () => {
  it("declares only the twelve required top-level keys", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(TOP_LEVEL_KEYS).toEqual(EXACT_TOP_LEVEL_KEYS);
    expect(REQUIRED_SECTIONS).toEqual(EXACT_TOP_LEVEL_KEYS.slice(1));
    expect(FEATURE_KEYS).toHaveLength(11);
    expect(KILLSWITCH_KEYS).toHaveLength(7);
    expect(SAMPLING_SIGNALS).toEqual([
      "errors",
      "traces",
      "spans",
      "requests",
      "metrics",
      "logs",
      "events",
      "messages",
      "profiles",
      "replays",
      "crons",
    ]);
    expect(INSTRUMENTATION_KEYS).toHaveLength(14);
    expect(PII_DETECTION_KEYS).toEqual(["enabled", "maskEmails", "maskPhones", "maskIPs"]);
    expect(ROUTE_KEYS).toHaveLength(10);
  });

  it("matches the exact canonical initial JSON snapshot", () => {
    const config = compileInitial(IDENTITY, TOPOLOGY, AT);
    expect(snapshotWithoutHash(config)).toEqual(EXPECTED_SNAPSHOT);
    expect(Object.keys(config)).toEqual(EXACT_TOP_LEVEL_KEYS);
    expect(config.meta.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(config.meta.configHash).toBe(computeConfigHash(config));
    expect(() => validateSchemaV1(config)).not.toThrow();
  });

  it("contains no compatibility fields or alternate representations", () => {
    const serialized = JSON.stringify(compileInitial(IDENTITY, TOPOLOGY, AT));
    for (const legacy of [
      '"routeOverrides"',
      '"pii"',
      '"integrations"',
      '"featureFlags"',
      '"samplingRules"',
      '"ingestUrl"',
      '"apiEndpoint"',
      '"config_value"',
      '"environment_id"',
    ]) {
      expect(serialized).not.toContain(legacy);
    }
  });

  it("rejects unknown and legacy document fields", () => {
    const extraTopLevel = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as SchemaV1Config & { featureFlags?: unknown };
    extraTopLevel.featureFlags = {};
    expect(expectSdkError(() => validateSchemaV1(extraTopLevel)).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/featureFlags", rule: "unknown" })]),
    );

    const legacyPrivacy = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as unknown as Record<string, any>;
    legacyPrivacy.privacy.pii = { enabled: true };
    expect(expectSdkError(() => validateSchemaV1(legacyPrivacy)).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/privacy/pii", rule: "unknown" })]),
    );
  });
});

describe("compiler and canonical hash", () => {
  it("uses boolean instrumentation, route sampling, required governance, and auto memory", () => {
    const config = compileInitial(IDENTITY, TOPOLOGY, AT);
    expect(config.instrumentation).toEqual({
      http: true,
      https: true,
      fetch: true,
      axios: false,
      fastify: true,
      express: true,
      graphql: false,
      prisma: false,
      mongodb: false,
      redis: false,
      bullmq: false,
      pg: false,
      mysql2: false,
      eventEmitterPatch: true,
    });
    expect(config.sampling.routes).toEqual({
      "/health": { requests: 0, traces: 0, spans: 0, metrics: 0, logs: 0 },
      "/favicon.ico": { traces: 0, requests: 0 },
    });
    expect(config.limits.maxMemoryMb).toBe("auto");
    expect(config.limits.tenantGovernance).toEqual({
      enabled: false,
      maxTenantsTracked: 1000,
      quotaPerWindow: 10_000,
      windowDurationMs: 60_000,
      criticalReserve: 100,
    });
  });

  it("accepts auto or a bounded numeric maxMemoryMb and rejects old spellings", () => {
    expect(compile(baseInput({ limits: { maxMemoryMb: "auto" } })).limits.maxMemoryMb).toBe("auto");
    expect(compile(baseInput({ limits: { maxMemoryMb: 512 } })).limits.maxMemoryMb).toBe(512);
    expect(validateEditableLeaf(["limits", "maxMemoryMb"], 15)).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "min" })]),
    );
    expect(validateEditableLeaf(["limits", "maxMemoryMb"], "automatic")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "enum" })]),
    );
  });

  it("serializes and hashes deterministically without trusting meta.configHash", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(hashValue({ a: 1, b: 2, c: [1, 2] })).toBe(hashValue({ c: [1, 2], b: 2, a: 1 }));
    expect(canonicalJson(-0)).toBe("0");
    expect(() => canonicalJson(Number.NaN)).toThrow(SdkConfigError);

    const config = compile(baseInput({ sampling: { traces: 0.25 } }));
    const changedStoredHash = deepClone(config);
    changedStoredHash.meta.configHash = "deadbeef".repeat(8);
    expect(computeConfigHash(changedStoredHash)).toBe(config.meta.configHash);
    expect(canonicalJson(compile(baseInput({ sampling: { traces: 0.25 } })))).toBe(canonicalJson(config));
  });

  it("changes the hash when generatedAt changes", () => {
    const first = compile(baseInput({}, "2026-01-01T00:00:00.000Z"));
    const second = compile(baseInput({}, "2026-01-01T00:00:00.001Z"));
    expect(first.meta.generatedAt).not.toBe(second.meta.generatedAt);
    expect(first.meta.configHash).not.toBe(second.meta.configHash);
  });
});

describe("editable intent is a closed allowlist", () => {
  it.each([
    ["features", "tracing"],
    ["sampling", "routes", "/checkout", "traces"],
    ["instrumentation", "http"],
    ["privacy", "scrubbing", "enabled"],
    ["privacy", "piiDetection", "maskEmails"],
    ["limits", "maxMemoryMb"],
    ["limits", "tenantGovernance", "maxTenantsTracked"],
    ["transport", "routes", "traces", "compression"],
    ["transport", "routes", "traces", "priority"],
    ["transport", "keepAlive"],
    ["runtime", "configTtlSeconds"],
  ])("classifies %j as editable", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("editable");
  });

  it.each([
    ["schemaVersion"],
    ["sdk", "projectId"],
    ["meta", "generatedAt"],
    ["entitlements", "tracing"],
    ["transport", "routes", "traces", "url"],
  ])("classifies %j as protected", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("protected");
  });

  it.each([
    ["sampling", "routeOverrides"],
    ["instrumentation", "http", "enabled"],
    ["privacy", "pii", "enabled"],
    ["privacy", "scrubbing", "queryParams"],
    ["limits", "maxBreadcrumbs"],
    ["transport", "retry", "initialDelayMs"],
    ["runtime", "debug"],
  ])("classifies removed path %j as unknown", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("unknown");
  });

  it("rejects protected, unknown, and malformed admin writes atomically", () => {
    const currentIntent = { features: { tracing: true } };
    const before = deepClone(currentIntent);
    const protectedError = expectSdkError(() =>
      applyEditableMutation({
        currentIntent,
        method: "PUT",
        body: { editableConfig: { transport: { routes: { traces: { url: "https://evil.test" } } } } },
      }),
    );
    expect(protectedError).toMatchObject({ code: "protected_field", statusCode: 422 });
    expect(currentIntent).toEqual(before);

    expect(expectSdkError(() =>
      applyEditableMutation({ currentIntent, method: "PUT", body: { editableConfig: { sampling: { routeOverrides: true } } } }),
    )).toMatchObject({ code: "unknown_field", statusCode: 422 });

    expect(expectSdkError(() =>
      applyEditableMutation({ currentIntent, method: "PUT", body: { editableConfig: {}, compiledSnapshot: {} } }),
    )).toMatchObject({ code: "envelope_invalid", statusCode: 422 });
  });

  it("supports exact PUT replacement and PATCH merge/removal", () => {
    const put = applyEditableMutation({
      currentIntent: { features: { errors: false } },
      method: "PUT",
      body: { editableConfig: { features: { tracing: false }, limits: { maxMemoryMb: "auto" } } },
    });
    expect(put).toEqual({ features: { tracing: false }, limits: { maxMemoryMb: "auto" } });

    const patch = applyEditableMutation({
      currentIntent: { features: { tracing: true, errors: true } },
      method: "PATCH",
      body: { features: { tracing: false, errors: null } },
    });
    expect(patch).toEqual({ features: { tracing: false } });
  });

  it("projects only editable leaves and never leaks the compiled snapshot", () => {
    const compiled = compileInitial(IDENTITY, TOPOLOGY, AT);
    const view = projectEditableView({
      scope: { organizationId: "org1", projectId: IDENTITY.projectId, environmentId: "env1", environmentKey: "production" },
      compiled,
      requestedIntent: {},
      currentRevisionNo: 1,
    });
    const serialized = JSON.stringify(view);
    expect(view).toMatchObject({ type: "editableConfigView", revision: { currentRevisionNo: 1 } });
    expect(view.editableConfig).toEqual(extractEditableConfig(compiled));
    expect(view.editableConfig).not.toHaveProperty("schemaVersion");
    expect(view.editableConfig).not.toHaveProperty("sdk");
    expect(view.editableConfig).not.toHaveProperty("meta");
    expect(view.editableConfig).not.toHaveProperty("entitlements");
    expect((view.editableConfig as any).transport.routes.traces).not.toHaveProperty("url");
    expect(serialized).not.toContain("ingest.pulse.test");
  });

  it("retains the canonical hard bounds", () => {
    expect(BOUNDS["runtime.configTtlSeconds"]).toEqual({ min: 30, max: 86400, integer: true });
    expect(BOUNDS["route.flushIntervalMs"]).toEqual({ min: 0, max: 300000, integer: true });
  });
});

describe("validation and direct delivery", () => {
  it("rejects missing sections, extra routes, and cross-field violations", () => {
    const missing = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as unknown as Record<string, unknown>;
    delete missing.runtime;
    expect(expectSdkError(() => validateSchemaV1(missing)).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/runtime" })]),
    );

    const extraRoute = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as any;
    extraRoute.transport.routes.shadow = { ...extraRoute.transport.routes.traces };
    expect(expectSdkError(() => validateSchemaV1(extraRoute)).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/transport/routes/shadow", rule: "unknown" })]),
    );

    const invalidReserve = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT));
    invalidReserve.transport.queue.criticalReserve = 20_000;
    expect(expectSdkError(() => validateSchemaV1(invalidReserve)).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/transport/queue/criticalReserve", rule: "cross_field" })]),
    );
  });

  const mapping: ApiKeyMapping = {
    organizationId: "org1",
    projectId: "projA",
    defaultEnvironmentId: "envDefault",
    allowedEnvironmentIds: ["envDefault", "envStaging"],
  };

  it("resolves delivery identity only from authenticated key scope", () => {
    expect(resolveDeliveryScope(mapping, { projectId: "spoof", environmentId: "envStaging" })).toEqual({
      organizationId: "org1",
      projectId: "projA",
      environmentId: "envStaging",
      environment: null,
      usedDefaultFallback: false,
      source: "api_key",
    });
    expect(resolveDeliveryScope(mapping, { projectId: "projFromSdk", environment: "production", environmentId: "envSecret" })).toEqual({
      organizationId: "org1",
      projectId: "projFromSdk",
      environmentId: null,
      environment: "production",
      usedDefaultFallback: false,
      source: "sdk_metadata",
    });
    expect(selectDeliveryEnvironment(mapping, "envSecret")).toEqual({ environmentId: "envDefault", usedDefaultFallback: true });
    expect(expectSdkError(() => resolveDeliveryScope(mapping, { projectId: "spoof" }, { strictIdentity: true }))).toMatchObject({
      code: "identity_hint_mismatch",
    });
    expect(() => assertSupportedSchemaVersion(1)).not.toThrow();
    expect(() => assertSupportedSchemaVersion(2)).toThrow(SdkConfigError);
  });

  it("delivers the canonical document directly and only applies emergency disables", () => {
    const compiled = compile(baseInput({ features: { tracing: true } }));
    const direct = buildDeliverySnapshot({ compiled });
    expect(direct.config).toEqual(compiled);
    expect(direct.etag).toBe(`"cfg-${compiled.meta.configHash}"`);

    const disabled = buildDeliverySnapshot({
      compiled,
      override: { features: { tracing: false }, killswitches: { disableSDK: true } },
    });
    expect(disabled.config.features.tracing).toBe(false);
    expect(disabled.config.killswitches.disableSDK).toBe(true);
    expect(disabled.config.meta.configHash).toBe(computeConfigHash(disabled.config));
    expect(disabled.etag).not.toBe(direct.etag);
  });
});
