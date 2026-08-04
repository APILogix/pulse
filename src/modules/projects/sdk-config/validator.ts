import { computeConfigHash } from "./canonical.js";
import { SdkConfigError, SdkConfigErrorCollector, type SdkConfigErrorDetail } from "./errors.js";
import { toJsonPointer } from "./editable-allowlist.js";
import {
  COMPRESSION_MODES,
  ENTITLEMENT_KEYS,
  FEATURE_KEYS,
  GENERATOR_ID,
  INSTRUMENTATION_KEYS,
  KILLSWITCH_KEYS,
  PII_DETECTION_KEYS,
  PRIVACY_CAPTURE_KEYS,
  QUEUE_OVERFLOW_STRATEGIES,
  REQUIRED_SECTIONS,
  RETRY_BACKOFF_MODES,
  ROUTE_INGEST_PATHS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  SCHEMA_VERSION,
  TENANT_GOVERNANCE_KEYS,
  TOP_LEVEL_KEYS,
  TRANSPORT_PRIORITIES,
  type RouteKey,
  type SchemaV1Config,
} from "./schema-v1.js";

export interface NumericBound {
  min: number;
  max: number;
  integer: boolean;
  maxDecimals?: number;
}

export const BOUNDS = {
  "limits.maxSpansPerTrace": { min: 1, max: 5000, integer: true },
  "limits.maxSpanAttributes": { min: 1, max: 500, integer: true },
  "limits.maxAttributeLength": { min: 1, max: 16384, integer: true },
  "limits.maxPayloadSize": { min: 1024, max: 4194304, integer: true },
  "limits.maxQueueSize": { min: 1, max: 100000, integer: true },
  "limits.maxMemoryMb": { min: 16, max: 1024, integer: true },
  "transport.retry.maxRetries": { min: 0, max: 10, integer: true },
  "transport.retry.baseDelayMs": { min: 100, max: 30000, integer: true },
  "transport.queue.maxSize": { min: 1, max: 100000, integer: true },
  "transport.queue.criticalReserve": { min: 0, max: 100000, integer: true },
  "transport.connections.maxTotalConnections": { min: 1, max: 500, integer: true },
  "transport.connections.acquireTimeoutMs": { min: 100, max: 60000, integer: true },
  "runtime.configTtlSeconds": { min: 30, max: 86400, integer: true },
  "route.batchSize": { min: 1, max: 5000, integer: true },
  "route.flushIntervalMs": { min: 0, max: 300000, integer: true },
  "route.timeoutMs": { min: 250, max: 60000, integer: true },
  "tenant.maxTenantsTracked": { min: 1, max: 100000, integer: true },
  "tenant.quotaPerWindow": { min: 1, max: 1000000, integer: true },
  "tenant.windowDurationMs": { min: 1000, max: 3600000, integer: true },
  "tenant.criticalReserve": { min: 0, max: 100000, integer: true },
} as const satisfies Record<string, NumericBound>;

export const SAMPLING_RATE_BOUND: NumericBound = { min: 0, max: 1, integer: false };
export const MAX_SAMPLING_ROUTES = 1000;
export const MAX_ROUTE_PATH_BYTES = 512;
export const MAX_SCRUB_PATTERNS = 500;
export const MAX_PATTERN_BYTES = 512;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(
  value: unknown,
  pointer: string,
  out: SdkConfigErrorDetail[],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    out.push({ path: pointer, rule: "type", message: "Value must be an object", requested: value });
    return {};
  }
  return value;
}

function checkExactKeys(
  pointer: string,
  value: Record<string, unknown>,
  required: readonly string[],
  out: SdkConfigErrorDetail[],
): void {
  const expected = new Set(required);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      out.push({ path: `${pointer}/${key}`, rule: "required", message: `Missing required field '${key}'` });
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      out.push({ path: `${pointer}/${key}`, rule: "unknown", message: `Unexpected field '${key}'` });
    }
  }
}

function checkBoolean(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (typeof value !== "boolean") {
    out.push({ path: pointer, rule: "type", message: "Value must be a boolean", requested: value });
  }
}

function checkString(
  pointer: string,
  value: unknown,
  out: SdkConfigErrorDetail[],
  options: { nonEmpty?: boolean; maxBytes?: number } = {},
): void {
  if (typeof value !== "string") {
    out.push({ path: pointer, rule: "type", message: "Value must be a string", requested: value });
    return;
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (options.nonEmpty && bytes === 0) {
    out.push({ path: pointer, rule: "required", message: "Value must not be empty" });
  }
  if (options.maxBytes !== undefined && bytes > options.maxBytes) {
    out.push({ path: pointer, rule: "length", message: `Value must be at most ${options.maxBytes} UTF-8 bytes` });
  }
}

function countDecimals(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1] ?? 0);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function checkNumber(
  pointer: string,
  value: unknown,
  bound: NumericBound,
  out: SdkConfigErrorDetail[],
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    out.push({ path: pointer, rule: "type", message: "Value must be a finite number", requested: value });
    return;
  }
  if (bound.integer && !Number.isInteger(value)) {
    out.push({ path: pointer, rule: "integer", message: "Value must be an integer", requested: value });
    return;
  }
  if (bound.maxDecimals !== undefined && countDecimals(value) > bound.maxDecimals) {
    out.push({ path: pointer, rule: "precision", message: `Value must have at most ${bound.maxDecimals} decimal places`, requested: value });
  }
  if (value < bound.min || value > bound.max) {
    out.push({
      path: pointer,
      rule: value < bound.min ? "min" : "max",
      message: `Value must be within [${bound.min}, ${bound.max}]`,
      requested: value,
      allowed: { min: bound.min, max: bound.max },
    });
  }
}

function checkEnum(
  pointer: string,
  value: unknown,
  values: readonly string[],
  out: SdkConfigErrorDetail[],
): void {
  if (typeof value !== "string" || !values.includes(value)) {
    out.push({ path: pointer, rule: "enum", message: `Value must be one of: ${values.join(", ")}`, requested: value, allowed: values });
  }
}

function checkSamplingRate(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  checkNumber(pointer, value, SAMPLING_RATE_BOUND, out);
}

function checkStringArray(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (!Array.isArray(value)) {
    out.push({ path: pointer, rule: "type", message: "Value must be an array of strings", requested: value });
    return;
  }
  if (value.length > MAX_SCRUB_PATTERNS) {
    out.push({ path: pointer, rule: "max", message: `At most ${MAX_SCRUB_PATTERNS} entries are allowed`, requested: value.length });
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const itemPointer = `${pointer}/${index}`;
    checkString(itemPointer, entry, out, { nonEmpty: true, maxBytes: MAX_PATTERN_BYTES });
    if (typeof entry === "string") {
      if (seen.has(entry)) out.push({ path: itemPointer, rule: "duplicate", message: "Duplicate entry", requested: entry });
      seen.add(entry);
    }
  });
}

function checkMaxMemory(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (value === "auto") return;
  if (typeof value === "string") {
    out.push({ path: pointer, rule: "enum", message: "Value must be 'auto' or a number", requested: value, allowed: ["auto", "number"] });
    return;
  }
  checkNumber(pointer, value, BOUNDS["limits.maxMemoryMb"], out);
}

function validateSamplingRoutes(value: unknown, pointer: string, out: SdkConfigErrorDetail[]): void {
  const routes = objectValue(value, pointer, out);
  const entries = Object.entries(routes);
  if (entries.length > MAX_SAMPLING_ROUTES) {
    out.push({ path: pointer, rule: "max", message: `At most ${MAX_SAMPLING_ROUTES} route overrides are allowed`, requested: entries.length });
  }
  for (const [path, rawOverride] of entries) {
    const routePointer = `${pointer}/${path.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    const bytes = Buffer.byteLength(path, "utf8");
    if (!path.startsWith("/") || bytes > MAX_ROUTE_PATH_BYTES) {
      out.push({ path: routePointer, rule: "format", message: `Route key must start with '/' and be at most ${MAX_ROUTE_PATH_BYTES} UTF-8 bytes`, requested: path });
    }
    const override = objectValue(rawOverride, routePointer, out);
    if (Object.keys(override).length === 0) {
      out.push({ path: routePointer, rule: "min", message: "Route override must contain at least one sampling signal" });
    }
    for (const [signal, rate] of Object.entries(override)) {
      if (!SAMPLING_SIGNALS.includes(signal as (typeof SAMPLING_SIGNALS)[number])) {
        out.push({ path: `${routePointer}/${signal}`, rule: "unknown", message: `Unknown sampling signal '${signal}'` });
      } else {
        checkSamplingRate(`${routePointer}/${signal}`, rate, out);
      }
    }
  }
}

function validateTransportRoutes(value: unknown, out: SdkConfigErrorDetail[]): void {
  const routes = objectValue(value, "/transport/routes", out);
  checkExactKeys("/transport/routes", routes, ROUTE_KEYS, out);
  const routeFields = ["url", "batchSize", "flushIntervalMs", "timeoutMs", "compression", "priority"] as const;

  for (const routeKey of ROUTE_KEYS) {
    const base = `/transport/routes/${routeKey}`;
    const route = objectValue(routes[routeKey], base, out);
    checkExactKeys(base, route, routeFields, out);
    checkString(`${base}/url`, route.url, out, { nonEmpty: true });
    if (typeof route.url === "string") {
      try {
        const parsed = new URL(route.url);
        const hasAllowedProtocol = parsed.protocol === "https:" || parsed.protocol === "http:";
        if (!hasAllowedProtocol || !parsed.pathname.endsWith(ROUTE_INGEST_PATHS[routeKey])) {
          out.push({ path: `${base}/url`, rule: "topology", message: `URL must be HTTP(S) and end at ${ROUTE_INGEST_PATHS[routeKey]}`, requested: route.url });
        }
      } catch {
        out.push({ path: `${base}/url`, rule: "format", message: "URL must be valid" });
      }
    }
    checkNumber(`${base}/batchSize`, route.batchSize, BOUNDS["route.batchSize"], out);
    checkNumber(`${base}/flushIntervalMs`, route.flushIntervalMs, BOUNDS["route.flushIntervalMs"], out);
    checkNumber(`${base}/timeoutMs`, route.timeoutMs, BOUNDS["route.timeoutMs"], out);
    checkEnum(`${base}/compression`, route.compression, COMPRESSION_MODES, out);
    checkEnum(`${base}/priority`, route.priority, TRANSPORT_PRIORITIES, out);
  }
}

export function validateEditableLeaf(segments: string[], value: unknown): SdkConfigErrorDetail[] {
  const out: SdkConfigErrorDetail[] = [];
  const pointer = toJsonPointer(segments);
  const [head, ...rest] = segments as [string, ...string[]];

  switch (head) {
    case "features":
    case "killswitches":
    case "instrumentation":
      checkBoolean(pointer, value, out);
      break;
    case "runtime":
      if (rest[0] === "configTtlSeconds") checkNumber(pointer, value, BOUNDS["runtime.configTtlSeconds"], out);
      else checkBoolean(pointer, value, out);
      break;
    case "sampling":
      checkSamplingRate(pointer, value, out);
      break;
    case "privacy":
      if (rest[0] === "scrubbing" && (rest[1] === "headers" || rest[1] === "fields")) checkStringArray(pointer, value, out);
      else checkBoolean(pointer, value, out);
      break;
    case "limits":
      if (rest[0] === "maxMemoryMb") checkMaxMemory(pointer, value, out);
      else if (rest[0] === "tenantGovernance") {
        if (rest[1] === "enabled") checkBoolean(pointer, value, out);
        else {
          const bound = BOUNDS[`tenant.${rest[1]}` as keyof typeof BOUNDS];
          if (bound) checkNumber(pointer, value, bound, out);
        }
      } else {
        const bound = BOUNDS[`limits.${rest[0]}` as keyof typeof BOUNDS];
        if (bound) checkNumber(pointer, value, bound, out);
      }
      break;
    case "transport":
      validateTransportLeaf(rest, pointer, value, out);
      break;
  }
  return out;
}

function validateTransportLeaf(rest: string[], pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (rest[0] === "keepAlive" || (rest[0] === "retry" && rest[1] === "enabled")) {
    checkBoolean(pointer, value, out);
  } else if (rest[0] === "retry" && rest[1] === "backoff") {
    checkEnum(pointer, value, RETRY_BACKOFF_MODES, out);
  } else if (rest[0] === "queue" && rest[1] === "overflowStrategy") {
    checkEnum(pointer, value, QUEUE_OVERFLOW_STRATEGIES, out);
  } else if (rest[0] === "routes" && rest[2] === "compression") {
    checkEnum(pointer, value, COMPRESSION_MODES, out);
  } else if (rest[0] === "routes" && rest[2] === "priority") {
    checkEnum(pointer, value, TRANSPORT_PRIORITIES, out);
  } else {
    const key = rest[0] === "routes"
      ? `route.${rest[2]}`
      : `transport.${rest[0]}.${rest[1]}`;
    const bound = BOUNDS[key as keyof typeof BOUNDS];
    if (bound) checkNumber(pointer, value, bound, out);
  }
}

/** Validate the exact wire contract. Unknown and legacy fields are rejected. */
export function validateSchemaV1(config: unknown): asserts config is SchemaV1Config {
  const collector = new SdkConfigErrorCollector();
  const out: SdkConfigErrorDetail[] = [];
  const root = objectValue(config, "", out);
  checkExactKeys("", root, TOP_LEVEL_KEYS, out);

  if (root.schemaVersion !== SCHEMA_VERSION) {
    out.push({ path: "/schemaVersion", rule: "const", message: `schemaVersion must be ${SCHEMA_VERSION}`, requested: root.schemaVersion });
  }
  for (const section of REQUIRED_SECTIONS) objectValue(root[section], `/${section}`, out);

  const sdk = objectValue(root.sdk, "/sdk", out);
  checkExactKeys("/sdk", sdk, ["projectId", "environment", "release"], out);
  checkString("/sdk/projectId", sdk.projectId, out, { nonEmpty: true, maxBytes: 128 });
  checkString("/sdk/environment", sdk.environment, out, { nonEmpty: true, maxBytes: 64 });
  checkString("/sdk/release", sdk.release, out, { nonEmpty: true, maxBytes: 100 });

  const features = objectValue(root.features, "/features", out);
  checkExactKeys("/features", features, FEATURE_KEYS, out);
  for (const key of FEATURE_KEYS) checkBoolean(`/features/${key}`, features[key], out);

  const sampling = objectValue(root.sampling, "/sampling", out);
  checkExactKeys("/sampling", sampling, [...SAMPLING_SIGNALS, "routes"], out);
  for (const key of SAMPLING_SIGNALS) checkSamplingRate(`/sampling/${key}`, sampling[key], out);
  validateSamplingRoutes(sampling.routes, "/sampling/routes", out);

  const instrumentation = objectValue(root.instrumentation, "/instrumentation", out);
  checkExactKeys("/instrumentation", instrumentation, INSTRUMENTATION_KEYS, out);
  for (const key of INSTRUMENTATION_KEYS) checkBoolean(`/instrumentation/${key}`, instrumentation[key], out);

  const privacy = objectValue(root.privacy, "/privacy", out);
  checkExactKeys("/privacy", privacy, ["capture", "scrubbing", "piiDetection"], out);
  const capture = objectValue(privacy.capture, "/privacy/capture", out);
  checkExactKeys("/privacy/capture", capture, PRIVACY_CAPTURE_KEYS, out);
  for (const key of PRIVACY_CAPTURE_KEYS) checkBoolean(`/privacy/capture/${key}`, capture[key], out);
  const scrubbing = objectValue(privacy.scrubbing, "/privacy/scrubbing", out);
  checkExactKeys("/privacy/scrubbing", scrubbing, ["enabled", "headers", "fields"], out);
  checkBoolean("/privacy/scrubbing/enabled", scrubbing.enabled, out);
  checkStringArray("/privacy/scrubbing/headers", scrubbing.headers, out);
  checkStringArray("/privacy/scrubbing/fields", scrubbing.fields, out);
  const pii = objectValue(privacy.piiDetection, "/privacy/piiDetection", out);
  checkExactKeys("/privacy/piiDetection", pii, PII_DETECTION_KEYS, out);
  for (const key of PII_DETECTION_KEYS) checkBoolean(`/privacy/piiDetection/${key}`, pii[key], out);

  const limits = objectValue(root.limits, "/limits", out);
  const limitKeys = [
    "maxSpansPerTrace", "maxSpanAttributes", "maxAttributeLength", "maxPayloadSize",
    "maxQueueSize", "maxMemoryMb", "tenantGovernance",
  ] as const;
  checkExactKeys("/limits", limits, limitKeys, out);
  for (const key of limitKeys.slice(0, 5)) {
    checkNumber(`/limits/${key}`, limits[key], BOUNDS[`limits.${key}` as keyof typeof BOUNDS], out);
  }
  checkMaxMemory("/limits/maxMemoryMb", limits.maxMemoryMb, out);
  const tenant = objectValue(limits.tenantGovernance, "/limits/tenantGovernance", out);
  checkExactKeys("/limits/tenantGovernance", tenant, TENANT_GOVERNANCE_KEYS, out);
  checkBoolean("/limits/tenantGovernance/enabled", tenant.enabled, out);
  for (const key of TENANT_GOVERNANCE_KEYS.slice(1)) {
    checkNumber(`/limits/tenantGovernance/${key}`, tenant[key], BOUNDS[`tenant.${key}` as keyof typeof BOUNDS], out);
  }
  if (typeof tenant.criticalReserve === "number" && typeof tenant.quotaPerWindow === "number" && tenant.criticalReserve > tenant.quotaPerWindow) {
    out.push({ path: "/limits/tenantGovernance/criticalReserve", rule: "cross_field", message: "criticalReserve must be <= quotaPerWindow" });
  }

  const killswitches = objectValue(root.killswitches, "/killswitches", out);
  checkExactKeys("/killswitches", killswitches, KILLSWITCH_KEYS, out);
  for (const key of KILLSWITCH_KEYS) checkBoolean(`/killswitches/${key}`, killswitches[key], out);

  const transport = objectValue(root.transport, "/transport", out);
  checkExactKeys("/transport", transport, ["retry", "queue", "connections", "keepAlive", "routes"], out);
  const retry = objectValue(transport.retry, "/transport/retry", out);
  checkExactKeys("/transport/retry", retry, ["enabled", "maxRetries", "backoff", "baseDelayMs"], out);
  checkBoolean("/transport/retry/enabled", retry.enabled, out);
  checkNumber("/transport/retry/maxRetries", retry.maxRetries, BOUNDS["transport.retry.maxRetries"], out);
  checkEnum("/transport/retry/backoff", retry.backoff, RETRY_BACKOFF_MODES, out);
  checkNumber("/transport/retry/baseDelayMs", retry.baseDelayMs, BOUNDS["transport.retry.baseDelayMs"], out);
  const queue = objectValue(transport.queue, "/transport/queue", out);
  checkExactKeys("/transport/queue", queue, ["overflowStrategy", "maxSize", "criticalReserve"], out);
  checkEnum("/transport/queue/overflowStrategy", queue.overflowStrategy, QUEUE_OVERFLOW_STRATEGIES, out);
  checkNumber("/transport/queue/maxSize", queue.maxSize, BOUNDS["transport.queue.maxSize"], out);
  checkNumber("/transport/queue/criticalReserve", queue.criticalReserve, BOUNDS["transport.queue.criticalReserve"], out);
  const connections = objectValue(transport.connections, "/transport/connections", out);
  checkExactKeys("/transport/connections", connections, ["maxTotalConnections", "acquireTimeoutMs"], out);
  checkNumber("/transport/connections/maxTotalConnections", connections.maxTotalConnections, BOUNDS["transport.connections.maxTotalConnections"], out);
  checkNumber("/transport/connections/acquireTimeoutMs", connections.acquireTimeoutMs, BOUNDS["transport.connections.acquireTimeoutMs"], out);
  checkBoolean("/transport/keepAlive", transport.keepAlive, out);
  validateTransportRoutes(transport.routes, out);
  if (typeof queue.criticalReserve === "number" && typeof queue.maxSize === "number" && queue.criticalReserve > queue.maxSize) {
    out.push({ path: "/transport/queue/criticalReserve", rule: "cross_field", message: "criticalReserve must be <= maxSize" });
  }
  if (typeof limits.maxQueueSize === "number" && typeof queue.maxSize === "number" && limits.maxQueueSize > queue.maxSize) {
    out.push({ path: "/limits/maxQueueSize", rule: "cross_field", message: "maxQueueSize must be <= transport.queue.maxSize" });
  }

  const runtime = objectValue(root.runtime, "/runtime", out);
  checkExactKeys("/runtime", runtime, ["configTtlSeconds", "staleWhileRevalidate"], out);
  checkNumber("/runtime/configTtlSeconds", runtime.configTtlSeconds, BOUNDS["runtime.configTtlSeconds"], out);
  checkBoolean("/runtime/staleWhileRevalidate", runtime.staleWhileRevalidate, out);

  const meta = objectValue(root.meta, "/meta", out);
  checkExactKeys("/meta", meta, ["generatedAt", "generatedBy", "configHash"], out);
  checkString("/meta/generatedAt", meta.generatedAt, out, { nonEmpty: true });
  if (typeof meta.generatedAt === "string" && Number.isNaN(Date.parse(meta.generatedAt))) {
    out.push({ path: "/meta/generatedAt", rule: "format", message: "generatedAt must be an ISO date-time" });
  }
  if (meta.generatedBy !== GENERATOR_ID) {
    out.push({ path: "/meta/generatedBy", rule: "const", message: `generatedBy must be '${GENERATOR_ID}'`, requested: meta.generatedBy });
  }
  if (typeof meta.configHash !== "string" || !/^[0-9a-f]{64}$/.test(meta.configHash)) {
    out.push({ path: "/meta/configHash", rule: "format", message: "configHash must be a lowercase SHA-256 hex digest", requested: meta.configHash });
  }

  const entitlements = objectValue(root.entitlements, "/entitlements", out);
  checkExactKeys("/entitlements", entitlements, ENTITLEMENT_KEYS, out);
  for (const key of ENTITLEMENT_KEYS) checkBoolean(`/entitlements/${key}`, entitlements[key], out);

  if (out.length === 0) {
    const expectedHash = computeConfigHash(config as SchemaV1Config);
    if ((config as SchemaV1Config).meta.configHash !== expectedHash) {
      out.push({ path: "/meta/configHash", rule: "hash", message: "configHash does not match the complete configuration", requested: (config as SchemaV1Config).meta.configHash, allowed: expectedHash });
    }
  }

  collector.addAll(out);
  collector.throwIfAny("schema_invalid", "Configuration failed the SDK schema-v1 contract");
}
