import {
  FEATURE_KEYS,
  INSTRUMENTATION_KEYS,
  KILLSWITCH_KEYS,
  PERSISTENCE_GOVERNANCE_KEYS,
  PII_DETECTION_KEYS,
  PRIVACY_CAPTURE_KEYS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  TENANT_GOVERNANCE_KEYS,
} from "./schema-v1.js";

export type PathClass = "editable" | "protected" | "unknown";
export interface PathClassification {
  pathClass: PathClass;
  reason: "allowlisted" | "protected" | "container" | "root" | "unknown";
}

const FEATURE_SET = new Set<string>(FEATURE_KEYS);
const KILLSWITCH_SET = new Set<string>(KILLSWITCH_KEYS);
const SIGNAL_SET = new Set<string>(SAMPLING_SIGNALS);
const INSTRUMENTATION_SET = new Set<string>(INSTRUMENTATION_KEYS);
const ROUTE_SET = new Set<string>(ROUTE_KEYS);
const CAPTURE_SET = new Set<string>(PRIVACY_CAPTURE_KEYS);
const PII_SET = new Set<string>(PII_DETECTION_KEYS);
const TENANT_SET = new Set<string>(TENANT_GOVERNANCE_KEYS);
const PERSISTENCE_SET = new Set<string>(PERSISTENCE_GOVERNANCE_KEYS);

const LIMIT_SCALAR_KEYS = new Set([
  "maxSpansPerTrace",
  "maxSpanAttributes",
  "maxAttributeLength",
  "maxPayloadSize",
  "maxQueueSize",
  "maxMemoryMb",
]);
const RETRY_KEYS = new Set(["enabled", "maxRetries", "backoff", "baseDelayMs"]);
const QUEUE_KEYS = new Set(["overflowStrategy", "maxSize", "criticalReserve"]);
const CONNECTION_KEYS = new Set(["maxTotalConnections", "acquireTimeoutMs"]);
const ROUTE_EDITABLE_KEYS = new Set([
  "batchSize",
  "flushIntervalMs",
  "timeoutMs",
  "compression",
  "priority",
]);
const RUNTIME_KEYS = new Set(["configTtlSeconds", "staleWhileRevalidate"]);
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
const PROTECTED_SECTIONS = new Set(["schemaVersion", "sdk", "meta", "entitlements"]);

/** Arrays are validated and replaced as one editable value. */
export const EDITABLE_ARRAY_POINTERS = new Set([
  "/privacy/scrubbing/headers",
  "/privacy/scrubbing/fields",
]);

/** No instrumentation options exist in the new wire contract. */
export const INSTRUMENTATION_OPTION_ALLOWLIST_V1 = Object.freeze({});

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function toJsonPointer(segments: string[]): string {
  return segments.length === 0 ? "" : `/${segments.map(escapePointerToken).join("/")}`;
}

function leafIn(set: Set<string>, rest: string[]): PathClassification {
  return rest.length === 1 && set.has(rest[0]!)
    ? { pathClass: "editable", reason: "allowlisted" }
    : { pathClass: "unknown", reason: "unknown" };
}

export function classifyLeafPath(segments: string[]): PathClassification {
  if (segments.length === 0) return { pathClass: "protected", reason: "root" };
  const [head, ...rest] = segments as [string, ...string[]];

  if (PROTECTED_SECTIONS.has(head)) {
    return { pathClass: "protected", reason: "protected" };
  }
  if (rest.length === 0) {
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
    case "instrumentation":
      return leafIn(INSTRUMENTATION_SET, rest);
    case "sampling":
      return classifySampling(rest);
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

function classifySampling(rest: string[]): PathClassification {
  if (rest.length === 1 && SIGNAL_SET.has(rest[0]!)) {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  // /sampling/routes/{path}/{signal}; route path is a dynamic object key.
  if (rest.length === 3 && rest[0] === "routes" && SIGNAL_SET.has(rest[2]!)) {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  if (rest.length <= 2 && rest[0] === "routes") {
    return { pathClass: "protected", reason: "container" };
  }
  return { pathClass: "unknown", reason: "unknown" };
}

function classifyPrivacy(rest: string[]): PathClassification {
  if (rest[0] === "capture") return leafIn(CAPTURE_SET, rest.slice(1));
  if (rest[0] === "piiDetection") return leafIn(PII_SET, rest.slice(1));
  if (rest[0] === "scrubbing" && rest.length === 2) {
    return ["enabled", "headers", "fields"].includes(rest[1]!)
      ? { pathClass: "editable", reason: "allowlisted" }
      : { pathClass: "unknown", reason: "unknown" };
  }
  return { pathClass: "unknown", reason: "unknown" };
}

function classifyLimits(rest: string[]): PathClassification {
  if (rest.length === 1 && LIMIT_SCALAR_KEYS.has(rest[0]!)) {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  if (rest.length === 2 && rest[0] === "tenantGovernance" && TENANT_SET.has(rest[1]!)) {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  if (rest.length === 1 && rest[0] === "tenantGovernance") {
    return { pathClass: "protected", reason: "container" };
  }
  if (rest.length === 2 && rest[0] === "persistenceGovernance" && PERSISTENCE_SET.has(rest[1]!)) {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  if (rest.length === 1 && rest[0] === "persistenceGovernance") {
    return { pathClass: "protected", reason: "container" };
  }
  return { pathClass: "unknown", reason: "unknown" };
}

function classifyTransport(rest: string[]): PathClassification {
  if (rest.length === 1 && rest[0] === "keepAlive") {
    return { pathClass: "editable", reason: "allowlisted" };
  }
  if (rest[0] === "retry") return leafIn(RETRY_KEYS, rest.slice(1));
  if (rest[0] === "queue") return leafIn(QUEUE_KEYS, rest.slice(1));
  if (rest[0] === "connections") return leafIn(CONNECTION_KEYS, rest.slice(1));
  if (rest[0] !== "routes") return { pathClass: "unknown", reason: "unknown" };

  if (rest.length < 2) return { pathClass: "protected", reason: "container" };
  if (!ROUTE_SET.has(rest[1]!)) return { pathClass: "unknown", reason: "unknown" };
  if (rest.length === 2) return { pathClass: "protected", reason: "container" };
  if (rest.length !== 3) return { pathClass: "unknown", reason: "unknown" };
  if (rest[2] === "url") return { pathClass: "protected", reason: "protected" };
  return ROUTE_EDITABLE_KEYS.has(rest[2]!)
    ? { pathClass: "editable", reason: "allowlisted" }
    : { pathClass: "unknown", reason: "unknown" };
}
