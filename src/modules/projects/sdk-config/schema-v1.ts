/**
 * Schema-v1 contract for remote SDK configuration.
 *
 * This module is the single source of truth for the shape of the schema-v1
 * document that is compiled by the backend, stored in immutable revisions, and
 * delivered to the Node SDK. It is intentionally free of side effects so it can
 * be unit-tested and shared by the compiler, validator, allowlist, projection,
 * and delivery layers.
 *
 * Design references:
 * - design.md §4.1 (schema-v1 contract) — required sections, feature/killswitch
 *   keys, sampling signals, integrations, and the nine fixed transport routes.
 * - implementation.md "SDK Acceptance Check" — the exact acceptance rules the
 *   current Node SDK enforces.
 *
 * The wire schema version is fixed at 1 for current SDK compatibility. The
 * backend never emits a newer schema to the current SDK.
 */

/** Fixed wire schema version. Never changes for the current SDK contract. */
export const SCHEMA_VERSION = 1 as const;

/** Generator identity written into `meta.generatedBy`. */
export const GENERATOR_ID = "pulse-config-compiler@1" as const;

/**
 * The eleven telemetry feature toggles. Every value is a boolean.
 * Order is significant only for deterministic iteration; canonical output
 * always sorts keys.
 */
export const FEATURE_KEYS = [
  "tracing",
  "requestCapture",
  "errors",
  "metrics",
  "logging",
  "profiling",
  "crons",
  "sessionReplay",
  "runtimeMetrics",
  "eventLoopMonitoring",
  "gcMonitoring",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** The seven operational killswitches. Every value is a boolean. */
export const KILLSWITCH_KEYS = [
  "disableSDK",
  "disableTracing",
  "disableMetrics",
  "disableTransport",
  "disableProfiling",
  "disableErrors",
  "disableLogs",
] as const;
export type KillswitchKey = (typeof KILLSWITCH_KEYS)[number];

/** The six base sampling signals. Rates are numbers in [0, 1]. */
export const SAMPLING_SIGNALS = [
  "traces",
  "requests",
  "errors",
  "profiles",
  "replays",
  "metrics",
] as const;
export type SamplingSignal = (typeof SAMPLING_SIGNALS)[number];

/** The eleven auto-instrumentation integrations. */
export const INTEGRATION_KEYS = [
  "http",
  "https",
  "fetch",
  "axios",
  "fastify",
  "express",
  "graphql",
  "prisma",
  "mongodb",
  "redis",
  "bullmq",
] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

/**
 * The nine fixed transport routes. The SDK rejects a document that is missing
 * any of these keys, so the compiler always emits exactly these nine.
 */
export const ROUTE_KEYS = [
  "traces",
  "requests",
  "errors",
  "metrics",
  "logs",
  "profiles",
  "events",
  "crons",
  "replays",
] as const;
export type RouteKey = (typeof ROUTE_KEYS)[number];

/**
 * Ingest path templates per route. These are platform-owned topology and are
 * never user-editable. The compiler joins the trusted origin with these paths
 * to derive `transport.routes.*.url`.
 */
export const ROUTE_INGEST_PATHS: Readonly<Record<RouteKey, string>> = {
  traces: "/v1/traces",
  requests: "/v1/requests",
  errors: "/v1/errors",
  metrics: "/v1/metrics",
  logs: "/v1/logs",
  profiles: "/v1/profiles",
  events: "/v1/events",
  crons: "/v1/checkins",
  replays: "/v1/replays",
};

/** Deterministic scheduler priority per route. Platform-owned, protected. */
export const ROUTE_PRIORITY: Readonly<Record<RouteKey, number>> = {
  errors: 1,
  traces: 2,
  requests: 3,
  logs: 4,
  metrics: 5,
  events: 6,
  crons: 7,
  profiles: 8,
  replays: 9,
};

/** Allowed transport compression modes in schema-v1. */
export const COMPRESSION_MODES = ["gzip", "none"] as const;
export type CompressionMode = (typeof COMPRESSION_MODES)[number];

/** Editable privacy capture leaves. Every value is a boolean. */
export const PRIVACY_CAPTURE_KEYS = [
  "headers",
  "body",
  "query",
  "cookies",
  "response",
] as const;
export type PrivacyCaptureKey = (typeof PRIVACY_CAPTURE_KEYS)[number];

/** Editable PII masking leaves. Every value is a boolean. */
export const PRIVACY_PII_KEYS = [
  "enabled",
  "maskEmails",
  "maskCreditCards",
  "maskPhoneNumbers",
] as const;
export type PrivacyPiiKey = (typeof PRIVACY_PII_KEYS)[number];

/** Optional tenant-governance leaves under `limits.tenantGovernance`. */
export const TENANT_GOVERNANCE_KEYS = [
  "maxTenantsTracked",
  "quota",
  "windowMs",
  "reserve",
] as const;
export type TenantGovernanceKey = (typeof TENANT_GOVERNANCE_KEYS)[number];

// ---------------------------------------------------------------------------
// Schema-v1 document types (the compiled snapshot / delivery document).
// ---------------------------------------------------------------------------

export interface SdkIdentity {
  projectId: string;
  environment: string;
  release?: string;
}

export type FeatureFlags = Record<FeatureKey, boolean>;
export type Killswitches = Record<KillswitchKey, boolean>;
export type SamplingRates = Record<SamplingSignal, number>;

export interface SamplingRouteOverride {
  prefix: string;
  /** Per-signal rate overrides for requests matching the prefix. */
  traces?: number;
  requests?: number;
  errors?: number;
  profiles?: number;
  replays?: number;
  metrics?: number;
}

export interface Sampling extends SamplingRates {
  routeOverrides: SamplingRouteOverride[];
}

export interface IntegrationConfig {
  enabled: boolean;
  options?: Record<string, string | number | boolean>;
}
export type Instrumentation = Record<IntegrationKey, IntegrationConfig>;

export interface PrivacyCapture {
  headers: boolean;
  body: boolean;
  query: boolean;
  cookies: boolean;
  response: boolean;
}
export interface PrivacyScrubbing {
  headers: string[];
  fields: string[];
}
export interface PrivacyPii {
  enabled: boolean;
  maskEmails: boolean;
  maskCreditCards: boolean;
  maskPhoneNumbers: boolean;
}
export interface Privacy {
  capture: PrivacyCapture;
  scrubbing: PrivacyScrubbing;
  pii: PrivacyPii;
}

export interface TenantGovernance {
  maxTenantsTracked: number;
  quota: number;
  windowMs: number;
  reserve: number;
}
export interface Limits {
  maxSpansPerTrace: number;
  maxSpanAttributes: number;
  maxAttributeLength: number;
  maxPayloadSize: number;
  maxQueueSize: number;
  maxMemoryMb: number;
  maxCpuOverheadPercent: number;
  tenantGovernance?: TenantGovernance;
}

export interface TransportRoute {
  url: string;
  priority: number;
  batchSize: number;
  flushIntervalMs: number;
  timeoutMs: number;
  compression: CompressionMode;
}
export interface TransportRetry {
  maxRetries: number;
  baseDelayMs: number;
}
export interface TransportQueue {
  maxSize: number;
  criticalReserve: number;
}
export interface TransportConnections {
  total: number;
  acquireTimeoutMs: number;
}
export interface Transport {
  retry: TransportRetry;
  queue: TransportQueue;
  keepAlive: boolean;
  connections: TransportConnections;
  routes: Record<RouteKey, TransportRoute>;
}

export interface Runtime {
  configTtlSeconds: number;
  staleWhileRevalidate: boolean;
}

export interface ConfigMeta {
  generatedAt: string;
  generatedBy: string;
  environmentName?: string;
  configHash?: string;
}

/** A complete, valid schema-v1 document. */
export interface SchemaV1Config {
  schemaVersion: 1;
  sdk: SdkIdentity;
  features: FeatureFlags;
  sampling: Sampling;
  instrumentation: Instrumentation;
  privacy: Privacy;
  limits: Limits;
  killswitches: Killswitches;
  transport: Transport;
  runtime: Runtime;
  meta: ConfigMeta;
  entitlements?: Record<string, boolean>;
}

/** The ten required top-level sections that must exist in every document. */
export const REQUIRED_SECTIONS = [
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
] as const;
