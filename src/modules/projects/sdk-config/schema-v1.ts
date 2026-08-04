import {
  TYPED_INGEST_ROUTES,
  TYPED_INGEST_ROUTE_KEYS,
  type TransportRouteKey,
} from "../../ingestion/route-table.js";

/** The only SDK configuration contract emitted, stored, or accepted by Pulse. */
export const SCHEMA_VERSION = 1 as const;
export const GENERATOR_ID = "pulse-config-compiler@1" as const;
export const DEFAULT_SDK_RELEASE = "1.0.0" as const;

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

export const SAMPLING_SIGNALS = [
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
] as const;
export type SamplingSignal = (typeof SAMPLING_SIGNALS)[number];

export const INSTRUMENTATION_KEYS = [
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
  "pg",
  "mysql2",
  "eventEmitterPatch",
] as const;
export type InstrumentationKey = (typeof INSTRUMENTATION_KEYS)[number];

export const PRIVACY_CAPTURE_KEYS = [
  "headers",
  "body",
  "response",
  "query",
  "cookies",
] as const;
export type PrivacyCaptureKey = (typeof PRIVACY_CAPTURE_KEYS)[number];

export const PII_DETECTION_KEYS = [
  "enabled",
  "maskEmails",
  "maskPhones",
  "maskIPs",
] as const;
export type PiiDetectionKey = (typeof PII_DETECTION_KEYS)[number];

export const TENANT_GOVERNANCE_KEYS = [
  "enabled",
  "maxTenantsTracked",
  "quotaPerWindow",
  "windowDurationMs",
  "criticalReserve",
] as const;
export type TenantGovernanceKey = (typeof TENANT_GOVERNANCE_KEYS)[number];

export const ENTITLEMENT_KEYS = [
  "customSpans",
  "customMetrics",
  "profiling",
  "logging",
  "sessionReplay",
  "crons",
  "requestCapture",
  "tracing",
  "errors",
  "metrics",
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const ROUTE_KEYS = TYPED_INGEST_ROUTE_KEYS;
export type RouteKey = TransportRouteKey;

/** Route suffixes are derived from the same table that registers ingestion routes. */
export const ROUTE_INGEST_PATHS: Readonly<Record<RouteKey, string>> = {
  ...Object.fromEntries(
    TYPED_INGEST_ROUTES.map((route) => [route.routeKey, route.path]),
  ),
} as Readonly<Record<RouteKey, string>>;

export const COMPRESSION_MODES = ["gzip", "none"] as const;
export type CompressionMode = (typeof COMPRESSION_MODES)[number];
export const TRANSPORT_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type TransportPriority = (typeof TRANSPORT_PRIORITIES)[number];
export const RETRY_BACKOFF_MODES = ["exponential", "linear", "fixed"] as const;
export type RetryBackoff = (typeof RETRY_BACKOFF_MODES)[number];
export const QUEUE_OVERFLOW_STRATEGIES = ["drop_oldest", "drop_newest", "reject"] as const;
export type QueueOverflowStrategy = (typeof QUEUE_OVERFLOW_STRATEGIES)[number];

export interface SdkIdentity {
  projectId: string;
  environment: string;
  release: string;
}

export type FeatureFlags = Record<FeatureKey, boolean>;
export type Killswitches = Record<KillswitchKey, boolean>;
export type SamplingRates = Record<SamplingSignal, number>;
export type SamplingRouteOverride = Partial<Record<SamplingSignal, number>>;
export interface Sampling extends SamplingRates {
  routes: Record<string, SamplingRouteOverride>;
}

export type Instrumentation = Record<InstrumentationKey, boolean>;

export interface PrivacyCapture {
  headers: boolean;
  body: boolean;
  response: boolean;
  query: boolean;
  cookies: boolean;
}
export interface PrivacyScrubbing {
  enabled: boolean;
  headers: string[];
  fields: string[];
}
export interface PrivacyPiiDetection {
  enabled: boolean;
  maskEmails: boolean;
  maskPhones: boolean;
  maskIPs: boolean;
}
export interface Privacy {
  capture: PrivacyCapture;
  scrubbing: PrivacyScrubbing;
  piiDetection: PrivacyPiiDetection;
}

export type MaxMemoryMb = "auto" | number;
export interface TenantGovernance {
  enabled: boolean;
  maxTenantsTracked: number;
  quotaPerWindow: number;
  windowDurationMs: number;
  criticalReserve: number;
}
export interface Limits {
  maxSpansPerTrace: number;
  maxSpanAttributes: number;
  maxAttributeLength: number;
  maxPayloadSize: number;
  maxQueueSize: number;
  maxMemoryMb: MaxMemoryMb;
  tenantGovernance: TenantGovernance;
}

export interface TransportRoute {
  url: string;
  batchSize: number;
  flushIntervalMs: number;
  timeoutMs: number;
  compression: CompressionMode;
  priority: TransportPriority;
}
export interface TransportRetry {
  enabled: boolean;
  maxRetries: number;
  backoff: RetryBackoff;
  baseDelayMs: number;
}
export interface TransportQueue {
  overflowStrategy: QueueOverflowStrategy;
  maxSize: number;
  criticalReserve: number;
}
export interface TransportConnections {
  maxTotalConnections: number;
  acquireTimeoutMs: number;
}
export interface Transport {
  retry: TransportRetry;
  queue: TransportQueue;
  connections: TransportConnections;
  keepAlive: boolean;
  routes: Record<RouteKey, TransportRoute>;
}

export interface Runtime {
  configTtlSeconds: number;
  staleWhileRevalidate: boolean;
}

export interface ConfigMeta {
  generatedAt: string;
  generatedBy: string;
  configHash: string;
}

export type Entitlements = Record<EntitlementKey, boolean>;

/** Complete wire document. All sections and leaves are required. */
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
  entitlements: Entitlements;
}

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
  "entitlements",
] as const;

export const TOP_LEVEL_KEYS = ["schemaVersion", ...REQUIRED_SECTIONS] as const;
