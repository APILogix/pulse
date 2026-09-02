import { computeConfigHash } from "./canonical.js";
import { classifyLeafPath } from "./editable-allowlist.js";
import { deepClone, enumerateLeafPaths, setAtPath } from "./traversal.js";
import {
  DEFAULT_SDK_RELEASE,
  ENTITLEMENT_KEYS,
  FEATURE_KEYS,
  GENERATOR_ID,
  INSTRUMENTATION_KEYS,
  KILLSWITCH_KEYS,
  ROUTE_INGEST_PATHS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  SCHEMA_VERSION,
  type EntitlementKey,
  type FeatureKey,
  type Instrumentation,
  type InstrumentationKey,
  type KillswitchKey,
  type Limits,
  type PersistenceGovernance,
  type RouteKey,
  type SamplingSignal,
  type SchemaV1Config,
  type TransportRoute,
} from "./schema-v1.js";

export interface TrustedTopology {
  ingestBaseUrl: string;
}

export interface CompileIdentity {
  projectId: string;
  environment: string;
  release?: string;
}

type NumericLimitKey = Exclude<keyof Limits, "tenantGovernance" | "persistenceGovernance">;
type PersistenceGovernancePolicy = Partial<PersistenceGovernance>;

export interface OrgPolicy {
  forceFeaturesOff?: FeatureKey[];
  forceKillswitchesOn?: KillswitchKey[];
  maxSamplingRates?: Partial<Record<SamplingSignal, number>>;
  limitCeilings?: Partial<Record<NumericLimitKey, number>>;
  persistenceGovernance?: PersistenceGovernancePolicy;
  mandatoryScrubHeaders?: string[];
  mandatoryScrubFields?: string[];
  forcePiiEnabled?: boolean;
}

export interface CompileInput {
  identity: CompileIdentity;
  topology: TrustedTopology;
  requestedIntent: Record<string, unknown>;
  orgPolicy?: OrgPolicy;
  generatedAt: string;
  generatedBy?: string;
}

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
  "creditCard",
  "ssn",
  "access_token",
  "refresh_token",
  "client_secret",
] as const;

const ROUTE_DEFAULTS: Readonly<
  Record<RouteKey, Omit<TransportRoute, "url">>
> = {
  errors: {
    batchSize: 100,
    flushIntervalMs: 1000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "critical",
  },
  events: {
    batchSize: 100,
    flushIntervalMs: 2000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "high",
  },
  traces: {
    batchSize: 500,
    flushIntervalMs: 5000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "high",
  },
  spans: {
    batchSize: 500,
    flushIntervalMs: 5000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "normal",
  },
  requests: {
    batchSize: 500,
    flushIntervalMs: 5000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "high",
  },
  metrics: {
    batchSize: 1000,
    flushIntervalMs: 10000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "normal",
  },
  logs: {
    batchSize: 200,
    flushIntervalMs: 10000,
    timeoutMs: 5000,
    compression: "gzip",
    priority: "normal",
  },
  profiles: {
    batchSize: 5,
    flushIntervalMs: 30000,
    timeoutMs: 15000,
    compression: "gzip",
    priority: "low",
  },
  crons: {
    batchSize: 1,
    flushIntervalMs: 0,
    timeoutMs: 5000,
    compression: "none",
    priority: "high",
  },
  replays: {
    batchSize: 5,
    flushIntervalMs: 10000,
    timeoutMs: 30000,
    compression: "gzip",
    priority: "low",
  },
};

function schemaDefaults(): SchemaV1Config {
  const features = Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, true]),
  ) as SchemaV1Config["features"];
  const killswitches = Object.fromEntries(
    KILLSWITCH_KEYS.map((key) => [key, false]),
  ) as SchemaV1Config["killswitches"];
  const instrumentation = Object.fromEntries(
    INSTRUMENTATION_KEYS.map((key) => [key, true]),
  ) as Instrumentation;
  const entitlements = Object.fromEntries(
    ENTITLEMENT_KEYS.map((key) => [key, true]),
  ) as SchemaV1Config["entitlements"];

  return {
    schemaVersion: SCHEMA_VERSION,
    sdk: { projectId: "", environment: "", release: DEFAULT_SDK_RELEASE },
    features,
    sampling: {
      errors: 1,
      traces: 1,
      spans: 1,
      requests: 1,
      metrics: 1,
      logs: 1,
      events: 1,
      messages: 1,
      profiles: 1,
      replays: 1,
      crons: 1,
      routes: {},
    },
    instrumentation,
    privacy: {
      capture: {
        headers: false,
        body: false,
        response: false,
        query: false,
        cookies: false,
      },
      scrubbing: {
        enabled: true,
        headers: [...PLATFORM_MANDATORY_SCRUB_HEADERS],
        fields: [...PLATFORM_MANDATORY_SCRUB_FIELDS],
      },
      piiDetection: {
        enabled: true,
        maskEmails: true,
        maskPhones: true,
        maskIPs: true,
      },
    },
    limits: {
      maxSpansPerTrace: 5000,
      maxSpanAttributes: 200,
      maxAttributeLength: 8192,
      maxPayloadSize: 4194304,
      maxQueueSize: 100000,
      maxMemoryMb: "auto",
      tenantGovernance: {
        enabled: false,
        maxTenantsTracked: 1000,
        quotaPerWindow: 10000,
        windowDurationMs: 60000,
        criticalReserve: 100,
      },
      persistenceGovernance: {
        maxPersistPerMinute: 100_000,
        adaptive: true,
        budgetExceededLogIntervalMs: 60_000,
      },
    },
    killswitches,
    transport: {
      retry: {
        enabled: true,
        maxRetries: 3,
        backoff: "exponential",
        baseDelayMs: 500,
      },
      queue: {
        overflowStrategy: "drop_oldest",
        maxSize: 100000,
        criticalReserve: 10000,
      },
      connections: {
        maxTotalConnections: 100,
        acquireTimeoutMs: 5000,
      },
      keepAlive: true,
      routes: {} as Record<RouteKey, TransportRoute>,
    },
    runtime: {
      configTtlSeconds: 300,
      staleWhileRevalidate: true,
    },
    meta: {
      generatedAt: "",
      generatedBy: GENERATOR_ID,
      configHash: "",
    },
    entitlements,
  };
}

function deriveRouteUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function applyPlatformSafety(config: SchemaV1Config, input: CompileInput): void {
  config.sdk = {
    projectId: input.identity.projectId,
    environment: input.identity.environment,
    release: input.identity.release ?? DEFAULT_SDK_RELEASE,
  };

  const routes = {} as Record<RouteKey, TransportRoute>;
  for (const route of ROUTE_KEYS) {
    routes[route] = {
      url: deriveRouteUrl(input.topology.ingestBaseUrl, ROUTE_INGEST_PATHS[route]),
      ...ROUTE_DEFAULTS[route],
    };
  }
  config.transport.routes = routes;
  config.meta = {
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy ?? GENERATOR_ID,
    configHash: "",
  };
}

function applyIntent(config: SchemaV1Config, intent: Record<string, unknown>): void {
  const working = config as unknown as Record<string, unknown>;
  for (const leaf of enumerateLeafPaths(intent)) {
    if (leaf.segments.length === 0) continue;
    if (classifyLeafPath(leaf.segments).pathClass !== "editable") continue;
    setAtPath(working, leaf.segments, leaf.value);
  }
}

function enforceEnvelope(config: SchemaV1Config, policy: OrgPolicy | undefined): void {
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
  if (policy?.forcePiiEnabled) config.privacy.piiDetection.enabled = true;

  for (const feature of policy?.forceFeaturesOff ?? []) {
    config.features[feature] = false;
  }
  for (const killswitch of policy?.forceKillswitchesOn ?? []) {
    config.killswitches[killswitch] = true;
  }
  for (const signal of SAMPLING_SIGNALS) {
    const cap = policy?.maxSamplingRates?.[signal];
    if (typeof cap === "number" && config.sampling[signal] > cap) {
      config.sampling[signal] = cap;
    }
  }
  for (const key of Object.keys(policy?.limitCeilings ?? {}) as NumericLimitKey[]) {
    const ceiling = policy?.limitCeilings?.[key];
    const current = config.limits[key];
    if (typeof ceiling === "number" && typeof current === "number" && current > ceiling) {
      (config.limits[key] as number) = ceiling;
    }
  }

  const persistence = policy?.persistenceGovernance;
  if (persistence) {
    if (typeof persistence.maxPersistPerMinute === "number") {
      config.limits.persistenceGovernance.maxPersistPerMinute = Math.min(
        config.limits.persistenceGovernance.maxPersistPerMinute,
        persistence.maxPersistPerMinute,
      );
    }
    if (typeof persistence.adaptive === "boolean") {
      config.limits.persistenceGovernance.adaptive = persistence.adaptive;
    }
    if (typeof persistence.budgetExceededLogIntervalMs === "number") {
      config.limits.persistenceGovernance.budgetExceededLogIntervalMs = Math.max(
        config.limits.persistenceGovernance.budgetExceededLogIntervalMs,
        persistence.budgetExceededLogIntervalMs,
      );
    }
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function compile(input: CompileInput): SchemaV1Config {
  const config = schemaDefaults();
  applyPlatformSafety(config, input);
  applyIntent(config, deepClone(input.requestedIntent));
  enforceEnvelope(config, input.orgPolicy);
  config.meta.configHash = computeConfigHash(config);
  return config;
}

export function compileInitial(
  identity: CompileIdentity,
  topology: TrustedTopology,
  generatedAt: string,
  orgPolicy?: OrgPolicy,
): SchemaV1Config {
  return compile({
    identity,
    topology,
    requestedIntent: {},
    generatedAt,
    ...(orgPolicy !== undefined ? { orgPolicy } : {}),
  });
}
