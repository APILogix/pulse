/**
 * Closed editable path allowlist and protected/unknown classification.
 *
 * This is the security core of remote config management (design.md §8.1/§8.2,
 * ADR-009). Every touched JSON pointer in a PUT/PATCH body is classified as
 * exactly one of:
 *   - "editable"  : an allowlisted user-writable leaf, subject to bounds/policy.
 *   - "protected" : a real schema-v1 location that is backend-owned (rejected).
 *   - "unknown"   : a path that is not part of schema-v1 at all (rejected).
 *
 * Protected and unknown are BOTH rejected with 422 — never silently ignored.
 * The allowlist is closed: it cannot be extended at runtime. `transport.routes.
 * *.url`, `schemaVersion`, `sdk.*`, `meta.*`, and `entitlements.*` are protected.
 */
import { FEATURE_KEYS, INTEGRATION_KEYS, KILLSWITCH_KEYS, PRIVACY_CAPTURE_KEYS, PRIVACY_PII_KEYS, ROUTE_KEYS, SAMPLING_SIGNALS, TENANT_GOVERNANCE_KEYS, } from "./schema-v1.js";
const FEATURE_SET = new Set(FEATURE_KEYS);
const KILLSWITCH_SET = new Set(KILLSWITCH_KEYS);
const SIGNAL_SET = new Set(SAMPLING_SIGNALS);
const INTEGRATION_SET = new Set(INTEGRATION_KEYS);
const ROUTE_SET = new Set(ROUTE_KEYS);
const CAPTURE_SET = new Set(PRIVACY_CAPTURE_KEYS);
const PII_SET = new Set(PRIVACY_PII_KEYS);
const TENANT_SET = new Set(TENANT_GOVERNANCE_KEYS);
const LIMIT_SCALAR_KEYS = new Set([
    "maxSpansPerTrace",
    "maxSpanAttributes",
    "maxAttributeLength",
    "maxPayloadSize",
    "maxQueueSize",
    "maxMemoryMb",
    "maxCpuOverheadPercent",
]);
const ROUTE_TUNING_KEYS = new Set(["batchSize", "flushIntervalMs", "timeoutMs"]);
const ROUTE_PROTECTED_KEYS = new Set(["url", "priority", "compression"]);
const RETRY_KEYS = new Set(["maxRetries", "baseDelayMs"]);
const QUEUE_KEYS = new Set(["maxSize", "criticalReserve"]);
const CONNECTION_KEYS = new Set(["total", "acquireTimeoutMs"]);
const RUNTIME_KEYS = new Set(["configTtlSeconds", "staleWhileRevalidate"]);
/** Known top-level sections. Writing a whole section (container) is protected. */
const TOP_LEVEL_SECTIONS = new Set([
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
]);
/** Fully backend-owned top-level sections (every descendant is protected). */
const PROTECTED_SECTIONS = new Set(["schemaVersion", "sdk", "meta", "entitlements"]);
/**
 * Versioned, closed registry of safe declarative instrumentation option leaves.
 * Only scalar options may ever appear here — never callbacks, code, module/file
 * paths, URLs, headers, or credentials (design.md §8.1). Leaves absent from this
 * registry are classified `unknown`.
 */
export const INSTRUMENTATION_OPTION_ALLOWLIST_V1 = {
    http: { captureRequestHeaders: "boolean" },
    https: { captureRequestHeaders: "boolean" },
    fetch: {},
    axios: {},
    fastify: {},
    express: {},
    graphql: { captureVariables: "boolean" },
    prisma: { logQueries: "boolean" },
    mongodb: {},
    redis: {},
    bullmq: {},
};
/** Editable leaves that are arrays (the whole array is the writable unit). */
export const EDITABLE_ARRAY_POINTERS = new Set([
    "/sampling/routeOverrides",
    "/privacy/scrubbing/headers",
    "/privacy/scrubbing/fields",
]);
/** Escape a single JSON Pointer reference token (RFC 6901). */
function escapePointerToken(token) {
    return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
/** Join reference-token segments into an RFC 6901 JSON Pointer string. */
export function toJsonPointer(segments) {
    if (segments.length === 0)
        return "";
    return "/" + segments.map(escapePointerToken).join("/");
}
/**
 * Classify a leaf path (as reference-token segments) against the closed
 * schema-v1 allowlist. The function never throws; callers decide how to react.
 */
export function classifyLeafPath(segments) {
    if (segments.length === 0)
        return { pathClass: "protected", reason: "root" };
    const [head, ...rest] = segments;
    // Whole-section writes and fully backend-owned sections.
    if (PROTECTED_SECTIONS.has(head))
        return { pathClass: "protected", reason: "protected" };
    if (rest.length === 0) {
        // A bare top-level key. Known sections are protected containers; the rest are unknown.
        return TOP_LEVEL_SECTIONS.has(head)
            ? { pathClass: "protected", reason: "container" }
            : { pathClass: "unknown", reason: "unknown" };
    }
    switch (head) {
        case "features":
            return leafIn(FEATURE_SET, rest);
        case "killswitches":
            return leafIn(KILLSWITCH_SET, rest);
        case "runtime":
            return leafIn(RUNTIME_KEYS, rest);
        case "sampling":
            return classifySampling(rest);
        case "instrumentation":
            return classifyInstrumentation(rest);
        case "privacy":
            return classifyPrivacy(rest);
        case "limits":
            return classifyLimits(rest);
        case "transport":
            return classifyTransport(rest);
        default:
            return { pathClass: "unknown", reason: "unknown" };
    }
}
/** A single-segment leaf inside a known set → editable; else unknown. */
function leafIn(set, rest) {
    if (rest.length === 1 && set.has(rest[0]))
        return { pathClass: "editable", reason: "allowlisted" };
    return { pathClass: "unknown", reason: "unknown" };
}
function classifySampling(rest) {
    if (rest.length === 1) {
        if (SIGNAL_SET.has(rest[0]))
            return { pathClass: "editable", reason: "allowlisted" };
        if (rest[0] === "routeOverrides")
            return { pathClass: "editable", reason: "allowlisted" };
        return { pathClass: "unknown", reason: "unknown" };
    }
    // routeOverrides is handled as a whole-array editable leaf; deeper scalar
    // pointers are still allowlisted for precise error reporting.
    if (rest[0] === "routeOverrides" && rest.length === 3) {
        const field = rest[2];
        if (field === "prefix" || SIGNAL_SET.has(field)) {
            return { pathClass: "editable", reason: "allowlisted" };
        }
        return { pathClass: "unknown", reason: "unknown" };
    }
    return { pathClass: "unknown", reason: "unknown" };
}
function classifyInstrumentation(rest) {
    const integration = rest[0];
    if (!INTEGRATION_SET.has(integration))
        return { pathClass: "unknown", reason: "unknown" };
    if (rest.length === 1)
        return { pathClass: "protected", reason: "container" };
    if (rest.length === 2 && rest[1] === "enabled") {
        return { pathClass: "editable", reason: "allowlisted" };
    }
    if (rest.length === 3 && rest[1] === "options") {
        const registry = INSTRUMENTATION_OPTION_ALLOWLIST_V1[integration];
        if (registry && Object.prototype.hasOwnProperty.call(registry, rest[2])) {
            return { pathClass: "editable", reason: "allowlisted" };
        }
        return { pathClass: "unknown", reason: "unknown" };
    }
    return { pathClass: "unknown", reason: "unknown" };
}
function classifyPrivacy(rest) {
    const group = rest[0];
    if (group === "capture")
        return leafIn(CAPTURE_SET, rest.slice(1));
    if (group === "pii")
        return leafIn(PII_SET, rest.slice(1));
    if (group === "scrubbing") {
        if (rest.length === 2 && (rest[1] === "headers" || rest[1] === "fields")) {
            return { pathClass: "editable", reason: "allowlisted" };
        }
        if (rest.length === 1)
            return { pathClass: "protected", reason: "container" };
        return { pathClass: "unknown", reason: "unknown" };
    }
    return { pathClass: "unknown", reason: "unknown" };
}
function classifyLimits(rest) {
    if (rest.length === 1) {
        if (LIMIT_SCALAR_KEYS.has(rest[0]))
            return { pathClass: "editable", reason: "allowlisted" };
        if (rest[0] === "tenantGovernance")
            return { pathClass: "protected", reason: "container" };
        return { pathClass: "unknown", reason: "unknown" };
    }
    if (rest[0] === "tenantGovernance" && rest.length === 2 && TENANT_SET.has(rest[1])) {
        return { pathClass: "editable", reason: "allowlisted" };
    }
    return { pathClass: "unknown", reason: "unknown" };
}
function classifyTransport(rest) {
    const group = rest[0];
    if (group === "keepAlive")
        return { pathClass: "protected", reason: "protected" };
    if (group === "retry")
        return leafIn(RETRY_KEYS, rest.slice(1));
    if (group === "queue")
        return leafIn(QUEUE_KEYS, rest.slice(1));
    if (group === "connections")
        return leafIn(CONNECTION_KEYS, rest.slice(1));
    if (group === "routes") {
        // /transport/routes/{route}/{field}
        if (rest.length === 1)
            return { pathClass: "protected", reason: "container" };
        const route = rest[1];
        if (!ROUTE_SET.has(route))
            return { pathClass: "unknown", reason: "unknown" };
        if (rest.length === 2)
            return { pathClass: "protected", reason: "container" };
        const field = rest[2];
        if (rest.length === 3 && ROUTE_TUNING_KEYS.has(field)) {
            return { pathClass: "editable", reason: "allowlisted" };
        }
        // url, priority, compression, and any other route field are protected.
        if (rest.length === 3 && ROUTE_PROTECTED_KEYS.has(field)) {
            return { pathClass: "protected", reason: "protected" };
        }
        return { pathClass: "unknown", reason: "unknown" };
    }
    return { pathClass: "unknown", reason: "unknown" };
}
//# sourceMappingURL=editable-allowlist.js.map