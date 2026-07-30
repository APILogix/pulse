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
 *   keys, sampling signals, integrations, and the ten fixed transport routes.
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
 * The fixed transport routes. They are derived from the ingestion route table,
 * so the SDK config never advertises a write endpoint the backend does not
 * register.
 */
import { TYPED_INGEST_ROUTES, TYPED_INGEST_ROUTE_KEYS } from "../../ingestion/route-table.js";
export const ROUTE_KEYS = TYPED_INGEST_ROUTE_KEYS;
/**
 * Public ingest path templates per route. These include the Fastify module
 * mount prefix (`/api`) because SDKs call the externally exposed backend paths,
 * not the ingestion module's internal route suffixes. They are platform-owned
 * topology and are never user-editable. The compiler joins the trusted origin
 * with these paths to derive `transport.routes.*.url`.
 */
export const ROUTE_INGEST_PATHS = {
    ...Object.fromEntries(TYPED_INGEST_ROUTES.map((route) => [route.routeKey, `/api${route.path}`])),
};
/** Deterministic scheduler priority per route. Platform-owned, protected. */
export const ROUTE_PRIORITY = {
    errors: 1,
    events: 2,
    crons: 3,
    traces: 4,
    spans: 5,
    requests: 6,
    logs: 7,
    metrics: 8,
    profiles: 9,
    replays: 10,
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