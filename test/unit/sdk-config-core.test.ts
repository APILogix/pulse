/**
 * Enterprise remote SDK config — core verification suite.
 *
 * Each describe block maps to one or more of the strict requirements:
 *  R1  atomic init produces a complete valid revision-1 config
 *  R2  scope = org + project + environment (identity derived)
 *  R5  full compiled config; editable view never leaks it
 *  R6  frontend receives only EditableConfigView
 *  R7  users never update ingestion endpoints
 *  R8  reject transport.routes.*.url writes
 *  R9  reject protected/unknown fields (never silently ignore)
 *  R10 /v1/sdk-config resolves from key mapping, not body identity
 *  R11 append-only + rollback determinism
 *  R12 validate server-side (reject, not clamp)
 *  R13 schemaVersion stays 1
 */
import { describe, expect, it } from "vitest";

import {
  FEATURE_KEYS,
  KILLSWITCH_KEYS,
  REQUIRED_SECTIONS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  INTEGRATION_KEYS,
  SCHEMA_VERSION,
} from "../../src/modules/projects/sdk-config/schema-v1.js";
import { canonicalJson, computeConfigHash, hashValue } from "../../src/modules/projects/sdk-config/canonical.js";
import { classifyLeafPath } from "../../src/modules/projects/sdk-config/editable-allowlist.js";
import { validateSchemaV1, validateEditableLeaf, BOUNDS } from "../../src/modules/projects/sdk-config/validator.js";
import { compile, compileInitial, type CompileInput } from "../../src/modules/projects/sdk-config/compiler.js";
import {
  applyEditableMutation,
  extractEditableConfig,
  projectEditableView,
} from "../../src/modules/projects/sdk-config/editable-view.js";
import {
  assertSupportedSchemaVersion,
  buildDeliverySnapshot,
  resolveDeliveryScope,
  selectDeliveryEnvironment,
  type ApiKeyMapping,
} from "../../src/modules/projects/sdk-config/delivery.js";
import { SdkConfigError } from "../../src/modules/projects/sdk-config/errors.js";
import { deepClone } from "../../src/modules/projects/sdk-config/traversal.js";
import type { SchemaV1Config } from "../../src/modules/projects/sdk-config/schema-v1.js";

const TOPOLOGY = { ingestBaseUrl: "https://ingest.pulse.test" };
const IDENTITY = { projectId: "proj_123", environment: "production" };
const AT = "2026-01-01T00:00:00.000Z";

function baseInput(requestedIntent: Record<string, unknown> = {}): CompileInput {
  return { identity: IDENTITY, topology: TOPOLOGY, requestedIntent, generatedAt: AT };
}

function expectSdkError(fn: () => unknown): SdkConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SdkConfigError);
    return error as SdkConfigError;
  }
  throw new Error("Expected SdkConfigError to be thrown");
}

// ---------------------------------------------------------------------------

describe("schema-v1 contract constants (R13)", () => {
  it("fixes schemaVersion at 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
  it("declares exactly nine transport routes", () => {
    expect(ROUTE_KEYS).toHaveLength(9);
    expect([...ROUTE_KEYS].sort()).toEqual(
      ["traces", "requests", "errors", "metrics", "logs", "profiles", "events", "crons", "replays"].sort(),
    );
  });
  it("declares the required sections and key sets", () => {
    expect(REQUIRED_SECTIONS).toHaveLength(10);
    expect(FEATURE_KEYS).toHaveLength(11);
    expect(KILLSWITCH_KEYS).toHaveLength(7);
    expect(SAMPLING_SIGNALS).toHaveLength(6);
    expect(INTEGRATION_KEYS).toHaveLength(11);
  });
});

describe("atomic initial compile (R1, R2, R13)", () => {
  const config = compileInitial(IDENTITY, TOPOLOGY, AT);

  it("produces a complete valid schema-v1 document", () => {
    expect(() => validateSchemaV1(config)).not.toThrow();
    expect(config.schemaVersion).toBe(1);
  });
  it("derives sdk identity from the authoritative scope", () => {
    expect(config.sdk.projectId).toBe("proj_123");
    expect(config.sdk.environment).toBe("production");
  });
  it("emits all nine routes with derived trusted https URLs", () => {
    expect(Object.keys(config.transport.routes)).toHaveLength(9);
    for (const route of ROUTE_KEYS) {
      const url = config.transport.routes[route].url;
      expect(url.startsWith("https://ingest.pulse.test/")).toBe(true);
    }
    expect(config.transport.routes.crons.url).toBe("https://ingest.pulse.test/v1/checkins");
  });
  it("freezes meta and includes a 64-hex configHash", () => {
    expect(config.meta.generatedAt).toBe(AT);
    expect(config.meta.configHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("canonical JSON + deterministic hashing (R11 determinism)", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("hashes independently of key order", () => {
    expect(hashValue({ a: 1, b: 2, c: [1, 2] })).toBe(hashValue({ c: [1, 2], b: 2, a: 1 }));
  });
  it("normalizes negative zero and rejects non-finite numbers", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(() => canonicalJson(Number.NaN)).toThrow(SdkConfigError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(SdkConfigError);
  });
  it("omits meta.configHash from the hash input", () => {
    const config = compileInitial(IDENTITY, TOPOLOGY, AT);
    const baseline = computeConfigHash(config);
    const mutated = deepClone(config);
    mutated.meta.configHash = "deadbeef".repeat(8);
    expect(computeConfigHash(mutated)).toBe(baseline);
  });
  it("compiles deterministically for identical inputs", () => {
    const a = compile(baseInput({ sampling: { traces: 0.25 } }));
    const b = compile(baseInput({ sampling: { traces: 0.25 } }));
    expect(a.meta.configHash).toBe(b.meta.configHash);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("editable allowlist classification (R7, R8, R9)", () => {
  const protectedPaths = [
    ["schemaVersion"],
    ["sdk", "projectId"],
    ["sdk", "environment"],
    ["meta", "generatedAt"],
    ["meta", "configHash"],
    ["entitlements", "tracing"],
    ["transport", "routes", "traces", "url"],
    ["transport", "routes", "errors", "priority"],
    ["transport", "routes", "logs", "compression"],
    ["transport", "keepAlive"],
  ];
  const editablePaths = [
    ["features", "tracing"],
    ["killswitches", "disableTracing"],
    ["sampling", "traces"],
    ["sampling", "routeOverrides"],
    ["instrumentation", "http", "enabled"],
    ["instrumentation", "http", "options", "captureRequestHeaders"],
    ["privacy", "capture", "headers"],
    ["privacy", "scrubbing", "headers"],
    ["privacy", "pii", "enabled"],
    ["limits", "maxSpansPerTrace"],
    ["limits", "tenantGovernance", "quota"],
    ["transport", "routes", "traces", "batchSize"],
    ["transport", "retry", "maxRetries"],
    ["transport", "queue", "maxSize"],
    ["transport", "connections", "total"],
    ["runtime", "configTtlSeconds"],
  ];
  const unknownPaths = [
    ["features", "notARealFeature"],
    ["foo", "bar"],
    ["instrumentation", "http", "options", "evilCallback"],
    ["sampling", "nope"],
    ["transport", "routes", "notARoute", "batchSize"],
  ];

  it.each(protectedPaths)("classifies %j as protected", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("protected");
  });
  it.each(editablePaths)("classifies %j as editable", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("editable");
  });
  it.each(unknownPaths)("classifies %j as unknown", (...segments) => {
    expect(classifyLeafPath(segments).pathClass).toBe("unknown");
  });
});

describe("PUT/PATCH mutation rejects protected & unknown (R7, R8, R9)", () => {
  it("rejects transport.routes.*.url with protected_field and does not mutate", () => {
    const currentIntent = { features: { tracing: true } };
    const frozen = deepClone(currentIntent);
    const error = expectSdkError(() =>
      applyEditableMutation({
        currentIntent,
        method: "PUT",
        body: { editableConfig: { transport: { routes: { traces: { url: "https://evil.example" } } } } },
      }),
    );
    expect(error.code).toBe("protected_field");
    expect(error.statusCode).toBe(422);
    expect(error.details.some((d) => d.path === "/transport/routes/traces/url" && d.rule === "protected")).toBe(true);
    expect(currentIntent).toEqual(frozen); // unchanged
  });

  it("rejects unknown fields with unknown_field", () => {
    const error = expectSdkError(() =>
      applyEditableMutation({ currentIntent: {}, method: "PUT", body: { editableConfig: { features: { bogus: true } } } }),
    );
    expect(error.code).toBe("unknown_field");
    expect(error.statusCode).toBe(422);
  });

  it("rejects protected fields nested under editable objects", () => {
    const error = expectSdkError(() =>
      applyEditableMutation({
        currentIntent: {},
        method: "PUT",
        body: { editableConfig: { features: { tracing: true }, sdk: { projectId: "spoof" } } },
      }),
    );
    expect(error.details.some((d) => d.path === "/sdk/projectId")).toBe(true);
  });

  it("rejects unknown PUT envelope keys", () => {
    const error = expectSdkError(() =>
      applyEditableMutation({ currentIntent: {}, method: "PUT", body: { editableConfig: {}, extra: 1 } }),
    );
    expect(error.code).toBe("envelope_invalid");
    expect(error.statusCode).toBe(422);
  });

  it("rejects schemaVersion mutation via PATCH", () => {
    const error = expectSdkError(() =>
      applyEditableMutation({ currentIntent: {}, method: "PATCH", body: { schemaVersion: 2 } }),
    );
    expect(error.code).toBe("protected_field");
  });

  it("accepts a valid PUT and returns normalized editable intent", () => {
    const result = applyEditableMutation({
      currentIntent: {},
      method: "PUT",
      body: { editableConfig: { features: { tracing: false }, sampling: { traces: 0.5 } } },
    });
    expect(result).toEqual({ features: { tracing: false }, sampling: { traces: 0.5 } });
  });

  it("applies a PATCH merge and null removal", () => {
    const merged = applyEditableMutation({
      currentIntent: { features: { tracing: true, errors: true } },
      method: "PATCH",
      body: { features: { tracing: false } },
    });
    expect(merged).toEqual({ features: { tracing: false, errors: true } });

    const removed = applyEditableMutation({
      currentIntent: { features: { tracing: true } },
      method: "PATCH",
      body: { features: { tracing: null } },
    });
    expect(removed).toEqual({});
  });
});

describe("server-side value validation, reject not clamp (R12)", () => {
  it("rejects an out-of-range sampling rate through mutation", () => {
    const error = expectSdkError(() =>
      applyEditableMutation({ currentIntent: {}, method: "PUT", body: { editableConfig: { sampling: { traces: 2 } } } }),
    );
    expect(error.statusCode).toBe(422);
    expect(error.details.some((d) => d.path === "/sampling/traces" && d.rule === "max")).toBe(true);
  });
  it("rejects a limit below the hard minimum", () => {
    const details = validateEditableLeaf(["limits", "maxMemoryMb"], 2);
    expect(details.some((d) => d.rule === "min")).toBe(true);
  });
  it("rejects a non-integer where integers are required", () => {
    const details = validateEditableLeaf(["limits", "maxSpansPerTrace"], 3.5);
    expect(details.some((d) => d.rule === "integer")).toBe(true);
  });
  it("accepts an in-range editable value", () => {
    expect(validateEditableLeaf(["transport", "routes", "traces", "batchSize"], 50)).toEqual([]);
  });
  it("exposes the design §9 bounds matrix", () => {
    expect(BOUNDS["runtime.configTtlSeconds"]).toEqual({ min: 30, max: 86400, integer: true });
    expect(BOUNDS["route.flushIntervalMs"]).toEqual({ min: 100, max: 300000, integer: true });
  });
});

describe("full-document validation & cross-field invariants (R12, R13)", () => {
  it("passes a freshly compiled document", () => {
    expect(() => validateSchemaV1(compileInitial(IDENTITY, TOPOLOGY, AT))).not.toThrow();
  });
  it("rejects a wrong schemaVersion", () => {
    const config = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as SchemaV1Config & { schemaVersion: number };
    config.schemaVersion = 2;
    const error = expectSdkError(() => validateSchemaV1(config));
    expect(error.details.some((d) => d.path === "/schemaVersion")).toBe(true);
  });
  it("rejects a missing required section", () => {
    const config = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT)) as Record<string, unknown>;
    delete config["runtime"];
    const error = expectSdkError(() => validateSchemaV1(config));
    expect(error.details.some((d) => d.path === "/runtime")).toBe(true);
  });
  it("rejects fewer than nine routes", () => {
    const config = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT));
    delete (config.transport.routes as Record<string, unknown>)["replays"];
    const error = expectSdkError(() => validateSchemaV1(config));
    expect(error.details.some((d) => d.path === "/transport/routes/replays")).toBe(true);
  });
  it("rejects an unexpected extra route", () => {
    const config = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT));
    (config.transport.routes as Record<string, unknown>)["shadow"] = { ...config.transport.routes.traces };
    const error = expectSdkError(() => validateSchemaV1(config));
    expect(error.details.some((d) => d.path === "/transport/routes/shadow" && d.rule === "unknown")).toBe(true);
  });
  it("enforces batchSize <= queue.maxSize", () => {
    const config = deepClone(compileInitial(IDENTITY, TOPOLOGY, AT));
    config.transport.queue.maxSize = 100;
    config.transport.routes.traces.batchSize = 200;
    const error = expectSdkError(() => validateSchemaV1(config));
    expect(error.details.some((d) => d.path === "/transport/routes/traces/batchSize" && d.rule === "cross_field")).toBe(true);
  });
});

describe("EditableConfigView never leaks protected fields (R5, R6)", () => {
  const compiled = compileInitial(IDENTITY, TOPOLOGY, AT);
  const view = projectEditableView({
    scope: { organizationId: "org1", projectId: "proj_123", environmentId: "env1", environmentKey: "production" },
    compiled,
    requestedIntent: {},
    currentRevisionNo: 1,
  });

  it("only contains editable leaves", () => {
    const editable = extractEditableConfig(compiled);
    const leaves = enumerate(editable);
    for (const segments of leaves) {
      expect(classifyLeafPath(segments).pathClass).toBe("editable");
    }
  });
  it("excludes sdk identity, meta, schemaVersion, and route URLs", () => {
    const serialized = JSON.stringify(view);
    expect(view.editableConfig).not.toHaveProperty("sdk");
    expect(view.editableConfig).not.toHaveProperty("meta");
    expect(view.editableConfig).not.toHaveProperty("schemaVersion");
    expect(view.editableConfig).not.toHaveProperty("entitlements");
    // Route tuning is present but URLs/priority/compression are not.
    const traces = (view.editableConfig as any).transport.routes.traces;
    expect(traces).toHaveProperty("batchSize");
    expect(traces).not.toHaveProperty("url");
    expect(traces).not.toHaveProperty("priority");
    // The ingest origin never appears anywhere in the serialized view.
    expect(serialized.includes("ingest.pulse.test")).toBe(false);
  });
  it("is exactly an editableConfigView envelope", () => {
    expect(view.type).toBe("editableConfigView");
    expect(view.revision.currentRevisionNo).toBe(1);
    expect(view).toHaveProperty("effectiveSummary");
  });
  it("marks organization-narrowed values as constrained", () => {
    const narrowed = compile({ ...baseInput({ sampling: { traces: 0.9 } }), orgPolicy: { maxSamplingRates: { traces: 0.5 } } });
    expect(narrowed.sampling.traces).toBe(0.5);
    const narrowedView = projectEditableView({
      scope: view.scope,
      compiled: narrowed,
      requestedIntent: { sampling: { traces: 0.9 } },
      currentRevisionNo: 2,
    });
    expect(narrowedView.effectiveSummary["/sampling/traces"]).toEqual({
      value: 0.5,
      source: "organization-policy",
      constrained: true,
    });
  });
  it("marks project-set values with project-environment source", () => {
    const withIntent = compile(baseInput({ sampling: { traces: 0.3 } }));
    const v = projectEditableView({ scope: view.scope, compiled: withIntent, requestedIntent: { sampling: { traces: 0.3 } }, currentRevisionNo: 1 });
    expect(v.effectiveSummary["/sampling/traces"]).toEqual({ value: 0.3, source: "project-environment", constrained: false });
    expect(v.effectiveSummary["/features/tracing"]?.source).toBe("schema-default");
  });
});

describe("SDK delivery resolves from key mapping, not body (R10)", () => {
  const mapping: ApiKeyMapping = {
    organizationId: "org1",
    projectId: "projA",
    defaultEnvironmentId: "envDefault",
    allowedEnvironmentIds: ["envDefault", "envStaging"],
  };

  it("ignores body projectId for authorization", () => {
    const scope = resolveDeliveryScope(mapping, { projectId: "projEVIL", environmentId: "envStaging" });
    expect(scope.organizationId).toBe("org1");
    expect(scope.projectId).toBe("projA");
    expect(scope.environmentId).toBe("envStaging");
    expect(scope.usedDefaultFallback).toBe(false);
  });
  it("honors an environment hint only when granted", () => {
    expect(selectDeliveryEnvironment(mapping, "envStaging")).toEqual({ environmentId: "envStaging", usedDefaultFallback: false });
  });
  it("falls back to default for an ungranted or absent environment hint", () => {
    expect(selectDeliveryEnvironment(mapping, "envSECRET")).toEqual({ environmentId: "envDefault", usedDefaultFallback: true });
    expect(selectDeliveryEnvironment(mapping, null)).toEqual({ environmentId: "envDefault", usedDefaultFallback: true });
  });
  it("optionally rejects a mismatched body projectId under strict identity", () => {
    const error = expectSdkError(() => resolveDeliveryScope(mapping, { projectId: "x" }, { strictIdentity: true }));
    expect(error.code).toBe("identity_hint_mismatch");
  });
  it("rejects an unsupported schema version but accepts 1 / absent", () => {
    expect(() => assertSupportedSchemaVersion(1)).not.toThrow();
    expect(() => assertSupportedSchemaVersion(undefined)).not.toThrow();
    expect(() => assertSupportedSchemaVersion(2)).toThrow(SdkConfigError);
  });
});

describe("delivery snapshot: projection, override, ETag", () => {
  const compiled = compileInitial(IDENTITY, TOPOLOGY, AT);

  it("returns a valid schema-v1 doc with a stable cfg- ETag", () => {
    const a = buildDeliverySnapshot({ compiled });
    const b = buildDeliverySnapshot({ compiled });
    expect(() => validateSchemaV1(a.config)).not.toThrow();
    expect(a.etag).toBe(b.etag);
    expect(a.etag).toMatch(/^"cfg-[0-9a-f]{64}"$/);
  });
  it("capability projection can disable but never enable features", () => {
    const enabledCompiled = compile(baseInput({ features: { tracing: true, profiling: false } }));
    const snap = buildDeliverySnapshot({ compiled: enabledCompiled, capabilities: ["errors"] });
    expect(snap.config.features.tracing).toBe(false); // not advertised -> off
    expect(snap.config.features.profiling).toBe(false); // advertised but was off -> stays off
  });
  it("operator override forces killswitches on and changes the ETag", () => {
    const base = buildDeliverySnapshot({ compiled });
    const overridden = buildDeliverySnapshot({ compiled, override: { killswitches: { disableSDK: true } } });
    expect(overridden.config.killswitches.disableSDK).toBe(true);
    expect(overridden.etag).not.toBe(base.etag);
  });
});

describe("rollback determinism (R11)", () => {
  it("recompiling a prior intent yields an identical snapshot (append-only rollback semantics)", () => {
    const targetIntent = { features: { tracing: false }, sampling: { errors: 0.5 } };
    const original = compile(baseInput(targetIntent));
    const rolledBack = compile(baseInput(targetIntent));
    expect(rolledBack.meta.configHash).toBe(original.meta.configHash);
  });
});

/** Enumerate leaf segment-paths of a plain object (test helper). */
function enumerate(value: unknown, base: string[] = []): string[][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [base];
  const out: string[][] = [];
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out.push(...enumerate((value as Record<string, unknown>)[key], [...base, key]));
  }
  return out;
}
