/**
 * Deterministic, side-effect-free schema-v1 compiler.
 *
 * Precedence (implementation.md "Compiler Precedence", design.md §4.2):
 *   1. Schema defaults        — a complete, valid baseline document.
 *   2. Platform safety        — derived sdk identity, nine protected route URLs,
 *                               mandatory scrubbing, platform killswitches, meta.
 *   3. Organization policy    — narrows the envelope (caps, forced off/on).
 *   4. Project/env intent     — applies allowlisted values within the envelope.
 *   5. Envelope enforcement   — platform/org dominance always wins over intent.
 *
 * The result is a complete schema-v1 document with a frozen `meta.generatedAt`
 * and a deterministic `meta.configHash`. Given identical inputs (including the
 * passed `generatedAt`), the output bytes and hash are identical (Property 5).
 */
import { computeConfigHash } from "./canonical.js";
import { classifyLeafPath } from "./editable-allowlist.js";
import { deepClone, enumerateLeafPaths, setAtPath } from "./traversal.js";
import {
  FEATURE_KEYS,
  GENERATOR_ID,
  INTEGRATION_KEYS,
  KILLSWITCH_KEYS,
  ROUTE_INGEST_PATHS,
  ROUTE_KEYS,
  ROUTE_PRIORITY,
  SAMPLING_SIGNALS,
  SCHEMA_VERSION,
  type FeatureKey,
  type Instrumentation,
  type IntegrationKey,
  type KillswitchKey,
  type Limits,
  type SamplingSignal,
  type SchemaV1Config,
  type Transport,
  type TransportRoute,
} from "./schema-v1.js";

/** Trusted, platform-owned ingest topology. Never user-supplied. */
export interface TrustedTopology {
  /** HTTPS origin used to derive every route URL, e.g. `https://ingest.pulse.dev`. */
  ingestBaseUrl: string;
}

/** Immutable identity derived from the authoritative project/environment scope. */
export interface CompileIdentity {
  projectId: string;
  environment: string;
  release?: string;
}

/** Organization policy that narrows the editable envelope. All fields optional. */
export interface OrgPolicy {
  forceFeaturesOff?: FeatureKey[];
  forceKillswitchesOn?: KillswitchKey[];
  maxSamplingRates?: Partial<Record<SamplingSignal, number>>;
  limitCeilings?: Partial<Record<keyof LimitScalars, number>>;
  mandatoryScrubHeaders?: string[];
  mandatoryScrubFields?: string[];
  forcePiiEnabled?: boolean;
}

type LimitScalars = Omit<Limits, "tenantGovernance">;

export interface CompileInput {
  identity: CompileIdentity;
  topology: TrustedTopology;
  /** Validated, allowlisted editable intent (requested_config). */
  requestedIntent: Record<string, unknown>;
  orgPolicy?: OrgPolicy;
  /** Frozen ISO timestamp for meta.generatedAt (caller supplies for determinism). */
  generatedAt: string;
  generatedBy?: string;
}

/** Platform-mandatory scrub rules that project intent can never remove. */
export const PLATFORM_MANDATORY_SCRUB_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
] as const;
export const PLATFORM_MANDATORY_SCRUB_FIELDS = [
  "password",
  "secret",
  "token",
  "apiKey",
  "authorization",
] as const;

/** Build the complete default document (layer 1). */
function schemaDefaults(): SchemaV1Config {
  const features = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, DEFAULT_FEATURES.has(key)]),
  ) as Record<FeatureKey, boolean>;
  const killswitches = Object.fromEntries(KILLSWITCH_KEYS.map((key) => [key, false])) as Record<
    KillswitchKey,
    boolean
  >;
  const sampling = {
    traces: 1,
    requests: 1,
    errors: 1,
    profiles: 0.1,
    replays: 0.1,
    metrics: 1,
    routeOverrides: [],
  };
  const instrumentation = Object.fromEntries(
    INTEGRATION_KEYS.map((key) => [key, { enabled: DEFAULT_INSTRUMENTATION.has(key) }]),
  ) as Instrumentation;

  return {
    schemaVersion: SCHEMA_VERSION,
    sdk: { projectId: "", environment: "" },
    features,
    sampling,
    instrumentation,
    privacy: {
      capture: { headers: false, body: false, query: false, cookies: false, response: false },
      scrubbing: { headers: [], fields: [] },
      pii: { enabled: true, maskEmails: true, maskCreditCards: true, maskPhoneNumbers: true },
    },
    limits: {
      maxSpansPerTrace: 2000,
      maxSpanAttributes: 128,
      maxAttributeLength: 4096,
      maxPayloadSize: 1048576,
      maxQueueSize: 10000,
      maxMemoryMb: 256,
      maxCpuOverheadPercent: 5,
    },
    killswitches,
    transport: {
      retry: { maxRetries: 3, baseDelayMs: 500 },
      queue: { maxSize: 10000, criticalReserve: 1000 },
      keepAlive: true,
      connections: { total: 50, acquireTimeoutMs: 5000 },
      routes: {} as Record<(typeof ROUTE_KEYS)[number], TransportRoute>,
    },
    runtime: { configTtlSeconds: 300, staleWhileRevalidate: true },
    meta: { generatedAt: "", generatedBy: GENERATOR_ID },
  };
}

const DEFAULT_FEATURES = new Set<FeatureKey>(["tracing", "requestCapture", "errors", "metrics", "logging"]);
const DEFAULT_INSTRUMENTATION = new Set<IntegrationKey>(["http", "https", "fetch", "express", "fastify"]);

/** Join the trusted origin with a route path, normalizing slashes. */
function deriveRouteUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path}`;
}

/** Layer 2: derive protected identity, route topology, and meta. */
function applyPlatformSafety(config: SchemaV1Config, input: CompileInput): void {
  config.sdk = { projectId: input.identity.projectId, environment: input.identity.environment };
  if (input.identity.release !== undefined) config.sdk.release = input.identity.release;

  const routes = {} as Record<(typeof ROUTE_KEYS)[number], TransportRoute>;
  for (const route of ROUTE_KEYS) {
    routes[route] = {
      url: deriveRouteUrl(input.topology.ingestBaseUrl, ROUTE_INGEST_PATHS[route]),
      priority: ROUTE_PRIORITY[route],
      batchSize: 100,
      flushIntervalMs: 5000,
      timeoutMs: 10000,
      compression: "gzip",
    };
  }
  config.transport.routes = routes;
  config.meta = { generatedAt: input.generatedAt, generatedBy: input.generatedBy ?? GENERATOR_ID };
}

/** Layer 4: apply validated, allowlisted editable intent. */
function applyIntent(config: SchemaV1Config, intent: Record<string, unknown>): void {
  const working = config as unknown as Record<string, unknown>;
  for (const leaf of enumerateLeafPaths(intent)) {
    if (leaf.segments.length === 0) continue;
    // Defense in depth: only apply leaves that classify as editable. Protected
    // or unknown intent (which should have been rejected at write time) is ignored.
    if (classifyLeafPath(leaf.segments).pathClass !== "editable") continue;
    setAtPath(working, leaf.segments, leaf.value);
  }
}

/** Layer 5: enforce platform + organization dominance over intent. */
function enforceEnvelope(config: SchemaV1Config, policy: OrgPolicy | undefined): void {
  // Mandatory scrubbing is additive and cannot be removed.
  config.privacy.scrubbing.headers = dedupe([
    ...PLATFORM_MANDATORY_SCRUB_HEADERS,
    ...(policy?.mandatoryScrubHeaders ?? []),
    ...config.privacy.scrubbing.headers,
  ]);
  config.privacy.scrubbing.fields = dedupe([
    ...PLATFORM_MANDATORY_SCRUB_FIELDS,
    ...(policy?.mandatoryScrubFields ?? []),
    ...config.privacy.scrubbing.fields,
  ]);
  if (policy?.forcePiiEnabled) config.privacy.pii.enabled = true;

  // Organization may force features off; project intent cannot re-enable them.
  for (const feature of policy?.forceFeaturesOff ?? []) {
    if (feature in config.features) config.features[feature] = false;
  }
  // Organization/platform killswitches dominate.
  for (const killswitch of policy?.forceKillswitchesOn ?? []) {
    if (killswitch in config.killswitches) config.killswitches[killswitch] = true;
  }
  // Sampling caps narrow (clamp) requested rates.
  for (const signal of SAMPLING_SIGNALS) {
    const cap = policy?.maxSamplingRates?.[signal];
    if (typeof cap === "number" && config.sampling[signal] > cap) config.sampling[signal] = cap;
  }
  // Limit ceilings narrow (clamp) requested limits.
  const ceilings = policy?.limitCeilings ?? {};
  for (const key of Object.keys(ceilings) as (keyof LimitScalars)[]) {
    const ceiling = ceilings[key];
    if (typeof ceiling === "number" && (config.limits[key] as number) > ceiling) {
      (config.limits[key] as number) = ceiling;
    }
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Compile a complete schema-v1 document. The output is deterministic for a given
 * input and always contains all ten sections and exactly nine routes.
 */
export function compile(input: CompileInput): SchemaV1Config {
  const config = schemaDefaults();
  applyPlatformSafety(config, input);
  applyIntent(config, deepClone(input.requestedIntent));
  enforceEnvelope(config, input.orgPolicy);
  // meta.configHash is computed last, over canonical content with configHash omitted.
  config.meta.configHash = computeConfigHash(config);
  return config;
}

/** Convenience for atomic environment initialization: compile with empty intent. */
export function compileInitial(
  identity: CompileIdentity,
  topology: TrustedTopology,
  generatedAt: string,
  orgPolicy?: OrgPolicy,
): SchemaV1Config {
  const input: CompileInput = { identity, topology, requestedIntent: {}, generatedAt };
  if (orgPolicy !== undefined) input.orgPolicy = orgPolicy;
  return compile(input);
}
