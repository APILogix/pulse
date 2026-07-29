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
export const SCHEMA_VERSION = 1;
/** Generator identity written into `meta.generatedBy`. */
export const GENERATOR_ID = "pulse-config-compiler@1";
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
];
/** The seven operational killswitches. Every value is a boolean. */
export const KILLSWITCH_KEYS = [
    "disableSDK",
    "disableTracing",
    "disableMetrics",
    "disableTransport",
    "disableProfiling",
    "disableErrors",
    "disableLogs",
];
/** The six base sampling signals. Rates are numbers in [0, 1]. */
export const SAMPLING_SIGNALS = [
    "traces",
    "requests",
    "errors",
    "profiles",
    "replays",
    "metrics",
];
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
];
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
];
/**
 * Ingest path templates per route. These are platform-owned topology and are
 * never user-editable. The compiler joins the trusted origin with these paths
 * to derive `transport.routes.*.url`.
 */
export const ROUTE_INGEST_PATHS = {
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
export const ROUTE_PRIORITY = {
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
export const COMPRESSION_MODES = ["gzip", "none"];
/** Editable privacy capture leaves. Every value is a boolean. */
export const PRIVACY_CAPTURE_KEYS = [
    "headers",
    "body",
    "query",
    "cookies",
    "response",
];
/** Editable PII masking leaves. Every value is a boolean. */
export const PRIVACY_PII_KEYS = [
    "enabled",
    "maskEmails",
    "maskCreditCards",
    "maskPhoneNumbers",
];
/** Optional tenant-governance leaves under `limits.tenantGovernance`. */
export const TENANT_GOVERNANCE_KEYS = [
    "maxTenantsTracked",
    "quota",
    "windowMs",
    "reserve",
];
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
];
//# sourceMappingURL=schema-v1.js.map