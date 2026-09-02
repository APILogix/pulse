import { TYPED_INGEST_ROUTES, TYPED_INGEST_ROUTE_KEYS, } from "../../ingestion/route-table.js";
/** The only SDK configuration contract emitted, stored, or accepted by Pulse. */
export const SCHEMA_VERSION = 1;
export const GENERATOR_ID = "pulse-config-compiler@1";
export const DEFAULT_SDK_RELEASE = "1.0.0";
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
];
export const KILLSWITCH_KEYS = [
    "disableSDK",
    "disableTracing",
    "disableMetrics",
    "disableTransport",
    "disableProfiling",
    "disableErrors",
    "disableLogs",
];
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
];
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
];
export const PRIVACY_CAPTURE_KEYS = [
    "headers",
    "body",
    "response",
    "query",
    "cookies",
];
export const PII_DETECTION_KEYS = [
    "enabled",
    "maskEmails",
    "maskPhones",
    "maskIPs",
];
export const TENANT_GOVERNANCE_KEYS = [
    "enabled",
    "maxTenantsTracked",
    "quotaPerWindow",
    "windowDurationMs",
    "criticalReserve",
];
export const PERSISTENCE_GOVERNANCE_KEYS = [
    "maxPersistPerMinute",
    "adaptive",
    "budgetExceededLogIntervalMs",
];
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
];
export const ROUTE_KEYS = TYPED_INGEST_ROUTE_KEYS;
/** Route suffixes are derived from the same table that registers ingestion routes. */
export const ROUTE_INGEST_PATHS = {
    ...Object.fromEntries(TYPED_INGEST_ROUTES.map((route) => [route.routeKey, route.path])),
};
export const COMPRESSION_MODES = ["gzip", "none"];
export const TRANSPORT_PRIORITIES = ["critical", "high", "normal", "low"];
export const RETRY_BACKOFF_MODES = ["exponential", "linear", "fixed"];
export const QUEUE_OVERFLOW_STRATEGIES = ["drop_oldest", "drop_newest", "reject"];
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
];
export const TOP_LEVEL_KEYS = ["schemaVersion", ...REQUIRED_SECTIONS];
//# sourceMappingURL=schema-v1.js.map