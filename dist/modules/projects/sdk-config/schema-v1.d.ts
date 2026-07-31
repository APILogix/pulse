import { type TransportRouteKey } from "../../ingestion/route-table.js";
/** The only SDK configuration contract emitted, stored, or accepted by Pulse. */
export declare const SCHEMA_VERSION: 1;
export declare const GENERATOR_ID: "pulse-config-compiler@1";
export declare const DEFAULT_SDK_RELEASE: "1.0.0";
export declare const FEATURE_KEYS: readonly ["tracing", "requestCapture", "errors", "metrics", "logging", "profiling", "crons", "sessionReplay", "runtimeMetrics", "eventLoopMonitoring", "gcMonitoring"];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export declare const KILLSWITCH_KEYS: readonly ["disableSDK", "disableTracing", "disableMetrics", "disableTransport", "disableProfiling", "disableErrors", "disableLogs"];
export type KillswitchKey = (typeof KILLSWITCH_KEYS)[number];
export declare const SAMPLING_SIGNALS: readonly ["errors", "traces", "spans", "requests", "metrics", "logs", "events", "messages", "profiles", "replays", "crons"];
export type SamplingSignal = (typeof SAMPLING_SIGNALS)[number];
export declare const INSTRUMENTATION_KEYS: readonly ["http", "https", "fetch", "axios", "fastify", "express", "graphql", "prisma", "mongodb", "redis", "bullmq", "pg", "mysql2", "eventEmitterPatch"];
export type InstrumentationKey = (typeof INSTRUMENTATION_KEYS)[number];
export declare const PRIVACY_CAPTURE_KEYS: readonly ["headers", "body", "response", "query", "cookies"];
export type PrivacyCaptureKey = (typeof PRIVACY_CAPTURE_KEYS)[number];
export declare const PII_DETECTION_KEYS: readonly ["enabled", "maskEmails", "maskPhones", "maskIPs"];
export type PiiDetectionKey = (typeof PII_DETECTION_KEYS)[number];
export declare const TENANT_GOVERNANCE_KEYS: readonly ["enabled", "maxTenantsTracked", "quotaPerWindow", "windowDurationMs", "criticalReserve"];
export type TenantGovernanceKey = (typeof TENANT_GOVERNANCE_KEYS)[number];
export declare const ENTITLEMENT_KEYS: readonly ["customSpans", "customMetrics", "profiling", "logging", "sessionReplay", "crons", "requestCapture", "tracing", "errors", "metrics"];
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];
export declare const ROUTE_KEYS: readonly TransportRouteKey[];
export type RouteKey = TransportRouteKey;
/** Route suffixes are derived from the same table that registers ingestion routes. */
export declare const ROUTE_INGEST_PATHS: Readonly<Record<RouteKey, string>>;
export declare const COMPRESSION_MODES: readonly ["gzip", "none"];
export type CompressionMode = (typeof COMPRESSION_MODES)[number];
export declare const TRANSPORT_PRIORITIES: readonly ["critical", "high", "normal", "low"];
export type TransportPriority = (typeof TRANSPORT_PRIORITIES)[number];
export declare const RETRY_BACKOFF_MODES: readonly ["exponential", "linear", "fixed"];
export type RetryBackoff = (typeof RETRY_BACKOFF_MODES)[number];
export declare const QUEUE_OVERFLOW_STRATEGIES: readonly ["drop_oldest", "drop_newest", "reject"];
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
export declare const REQUIRED_SECTIONS: readonly ["sdk", "features", "sampling", "instrumentation", "privacy", "limits", "killswitches", "transport", "runtime", "meta", "entitlements"];
export declare const TOP_LEVEL_KEYS: readonly ["schemaVersion", "sdk", "features", "sampling", "instrumentation", "privacy", "limits", "killswitches", "transport", "runtime", "meta", "entitlements"];
//# sourceMappingURL=schema-v1.d.ts.map