/**
 * Server-side validation for schema-v1 documents and editable intent.
 *
 * The backend is stricter than the SDK: it REJECTS out-of-range values rather
 * than relying on SDK clamps (design.md §9, ADR-007, Property 11). Two entry
 * points:
 *   - validateEditableLeaf(): per-leaf type + bounds check used during PUT/PATCH
 *     traversal so a single bad value is reported at its exact pointer.
 *   - validateSchemaV1(): full structural + bounds + cross-field validation of a
 *     compiled snapshot / delivery document (all sections, exactly nine routes).
 */
import { SdkConfigError, SdkConfigErrorCollector, type SdkConfigErrorDetail } from "./errors.js";
import { toJsonPointer, INSTRUMENTATION_OPTION_ALLOWLIST_V1 } from "./editable-allowlist.js";
import {
  COMPRESSION_MODES,
  FEATURE_KEYS,
  INTEGRATION_KEYS,
  KILLSWITCH_KEYS,
  PRIVACY_CAPTURE_KEYS,
  PRIVACY_PII_KEYS,
  REQUIRED_SECTIONS,
  ROUTE_KEYS,
  SAMPLING_SIGNALS,
  SCHEMA_VERSION,
  TENANT_GOVERNANCE_KEYS,
  type IntegrationKey,
  type SchemaV1Config,
} from "./schema-v1.js";

export interface NumericBound {
  min: number;
  max: number;
  integer: boolean;
  maxDecimals?: number;
}

/** Inclusive server hard bounds (design.md §9). Policy may narrow, never widen. */
export const BOUNDS = {
  "limits.maxSpansPerTrace": { min: 1, max: 5000, integer: true },
  "limits.maxSpanAttributes": { min: 1, max: 500, integer: true },
  "limits.maxAttributeLength": { min: 1, max: 16384, integer: true },
  "limits.maxPayloadSize": { min: 1024, max: 4194304, integer: true },
  "limits.maxQueueSize": { min: 1, max: 100000, integer: true },
  "limits.maxMemoryMb": { min: 16, max: 1024, integer: true },
  "limits.maxCpuOverheadPercent": { min: 0.1, max: 25, integer: false, maxDecimals: 3 },
  "transport.retry.maxRetries": { min: 0, max: 10, integer: true },
  "transport.retry.baseDelayMs": { min: 100, max: 30000, integer: true },
  "transport.queue.maxSize": { min: 1, max: 100000, integer: true },
  "transport.queue.criticalReserve": { min: 0, max: 100000, integer: true },
  "transport.connections.total": { min: 1, max: 500, integer: true },
  "transport.connections.acquireTimeoutMs": { min: 100, max: 60000, integer: true },
  "runtime.configTtlSeconds": { min: 30, max: 86400, integer: true },
  "route.batchSize": { min: 1, max: 5000, integer: true },
  "route.flushIntervalMs": { min: 100, max: 300000, integer: true },
  "route.timeoutMs": { min: 250, max: 60000, integer: true },
  "tenant.maxTenantsTracked": { min: 1, max: 100000, integer: true },
  "tenant.quota": { min: 1, max: 1000000, integer: true },
  "tenant.windowMs": { min: 1000, max: 3600000, integer: true },
  "tenant.reserve": { min: 0, max: 100000, integer: true },
} as const satisfies Record<string, NumericBound>;

export const SAMPLING_RATE_BOUND: NumericBound = { min: 0, max: 1, integer: false };
export const MAX_ROUTE_OVERRIDES = 1000;
export const MAX_PREFIX_BYTES = 512;
export const MAX_SCRUB_PATTERNS = 500;
export const MAX_PATTERN_BYTES = 512;

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");

function countDecimals(value: number): number {
  const text = value.toString();
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Validate a finite number against a bound, appending a detail if invalid. */
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
    out.push({
      path: pointer,
      rule: "precision",
      message: `Value must have at most ${bound.maxDecimals} decimal places`,
      requested: value,
    });
    return;
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

function checkBoolean(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (typeof value !== "boolean") {
    out.push({ path: pointer, rule: "type", message: "Value must be a boolean", requested: value });
  }
}

function checkSamplingRate(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  checkNumber(pointer, value, SAMPLING_RATE_BOUND, out);
}

/** Validate one editable route override entry within `/sampling/routeOverrides`. */
function checkRouteOverride(index: number, entry: unknown, out: SdkConfigErrorDetail[]): void {
  const base = `/sampling/routeOverrides/${index}`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    out.push({ path: base, rule: "type", message: "Route override must be an object" });
    return;
  }
  const record = entry as Record<string, unknown>;
  const prefix = record["prefix"];
  if (typeof prefix !== "string") {
    out.push({ path: `${base}/prefix`, rule: "type", message: "prefix must be a string" });
  } else {
    const bytes = utf8Bytes(prefix);
    if (bytes < 1 || bytes > MAX_PREFIX_BYTES) {
      out.push({
        path: `${base}/prefix`,
        rule: "length",
        message: `prefix must be 1..${MAX_PREFIX_BYTES} UTF-8 bytes`,
        requested: bytes,
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (key === "prefix") continue;
    if (!SAMPLING_SIGNALS.includes(key as (typeof SAMPLING_SIGNALS)[number])) {
      out.push({ path: `${base}/${key}`, rule: "unknown", message: `Unknown route override field '${key}'` });
      continue;
    }
    checkSamplingRate(`${base}/${key}`, record[key], out);
  }
}

/**
 * Validate a single editable leaf's value (type + bounds). `segments` are the
 * classified-editable reference tokens; `value` is the intended value. Returns
 * detail records (empty when valid). Does NOT perform cross-field checks.
 */
export function validateEditableLeaf(segments: string[], value: unknown): SdkConfigErrorDetail[] {
  const out: SdkConfigErrorDetail[] = [];
  const pointer = toJsonPointer(segments);
  const [head, ...rest] = segments as [string, ...string[]];

  switch (head) {
    case "features":
    case "killswitches":
      checkBoolean(pointer, value, out);
      break;
    case "runtime":
      if (rest[0] === "configTtlSeconds") checkNumber(pointer, value, BOUNDS["runtime.configTtlSeconds"], out);
      else if (rest[0] === "staleWhileRevalidate") checkBoolean(pointer, value, out);
      break;
    case "sampling":
      if (rest[0] === "routeOverrides") {
        if (!Array.isArray(value)) {
          out.push({ path: pointer, rule: "type", message: "routeOverrides must be an array" });
        } else if (value.length > MAX_ROUTE_OVERRIDES) {
          out.push({
            path: pointer,
            rule: "max",
            message: `At most ${MAX_ROUTE_OVERRIDES} route overrides`,
            requested: value.length,
          });
        } else {
          const seen = new Set<string>();
          value.forEach((entry, index) => {
            checkRouteOverride(index, entry, out);
            const prefix = (entry as Record<string, unknown> | null)?.["prefix"];
            if (typeof prefix === "string") {
              const normalized = prefix.trim();
              if (seen.has(normalized)) {
                out.push({
                  path: `/sampling/routeOverrides/${index}/prefix`,
                  rule: "duplicate",
                  message: "Duplicate normalized route override prefix",
                  requested: prefix,
                });
              }
              seen.add(normalized);
            }
          });
        }
      } else {
        checkSamplingRate(pointer, value, out);
      }
      break;
    case "instrumentation":
      if (rest[1] === "enabled") {
        checkBoolean(pointer, value, out);
      } else if (rest[1] === "options") {
        const registry = INSTRUMENTATION_OPTION_ALLOWLIST_V1[rest[0] as IntegrationKey] ?? {};
        const expected = registry[rest[2] ?? ""];
        if (!expected) {
          out.push({ path: pointer, rule: "unknown", message: "Unknown instrumentation option" });
        } else if (typeof value !== expected) {
          out.push({ path: pointer, rule: "type", message: `Option must be of type ${expected}`, requested: value });
        }
      }
      break;
    case "privacy":
      if (rest[0] === "capture" || rest[0] === "pii") {
        checkBoolean(pointer, value, out);
      } else if (rest[0] === "scrubbing") {
        checkStringArray(pointer, value, out);
      }
      break;
    case "limits":
      if (rest[0] === "tenantGovernance") {
        const key = `tenant.${rest[1]}` as keyof typeof BOUNDS;
        if (BOUNDS[key]) checkNumber(pointer, value, BOUNDS[key], out);
      } else {
        const key = `limits.${rest[0]}` as keyof typeof BOUNDS;
        if (BOUNDS[key]) checkNumber(pointer, value, BOUNDS[key], out);
      }
      break;
    case "transport":
      checkTransportLeaf(rest, pointer, value, out);
      break;
    default:
      break;
  }
  return out;
}

function checkStringArray(pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  if (!Array.isArray(value)) {
    out.push({ path: pointer, rule: "type", message: "Value must be an array of strings" });
    return;
  }
  if (value.length > MAX_SCRUB_PATTERNS) {
    out.push({ path: pointer, rule: "max", message: `At most ${MAX_SCRUB_PATTERNS} patterns`, requested: value.length });
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      out.push({ path: `${pointer}/${index}`, rule: "type", message: "Pattern must be a string" });
      return;
    }
    const bytes = utf8Bytes(entry);
    if (bytes < 1 || bytes > MAX_PATTERN_BYTES) {
      out.push({
        path: `${pointer}/${index}`,
        rule: "length",
        message: `Pattern must be 1..${MAX_PATTERN_BYTES} UTF-8 bytes`,
        requested: bytes,
      });
    }
  });
}

function checkTransportLeaf(rest: string[], pointer: string, value: unknown, out: SdkConfigErrorDetail[]): void {
  const group = rest[0];
  if (group === "retry") {
    const key = `transport.retry.${rest[1]}` as keyof typeof BOUNDS;
    if (BOUNDS[key]) checkNumber(pointer, value, BOUNDS[key], out);
  } else if (group === "queue") {
    const key = `transport.queue.${rest[1]}` as keyof typeof BOUNDS;
    if (BOUNDS[key]) checkNumber(pointer, value, BOUNDS[key], out);
  } else if (group === "connections") {
    const key = `transport.connections.${rest[1]}` as keyof typeof BOUNDS;
    if (BOUNDS[key]) checkNumber(pointer, value, BOUNDS[key], out);
  } else if (group === "routes") {
    const field = rest[2];
    if (field === "batchSize") checkNumber(pointer, value, BOUNDS["route.batchSize"], out);
    else if (field === "flushIntervalMs") checkNumber(pointer, value, BOUNDS["route.flushIntervalMs"], out);
    else if (field === "timeoutMs") checkNumber(pointer, value, BOUNDS["route.timeoutMs"], out);
  }
}

// ---------------------------------------------------------------------------
// Full compiled-document validation.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a complete compiled schema-v1 document. Throws a 422 SdkConfigError
 * with pointer-level details when anything is missing, mistyped, out of range,
 * or violates a cross-field invariant. This is the authoritative gate that the
 * compiler output and the delivery document must pass (design.md §9).
 */
export function validateSchemaV1(config: unknown): asserts config is SchemaV1Config {
  const collector = new SdkConfigErrorCollector();
  const out: SdkConfigErrorDetail[] = [];

  if (!isPlainObject(config)) {
    throw new SdkConfigError("schema_invalid", "Configuration must be an object", 422, [
      { path: "", rule: "type", message: "Root must be an object" },
    ]);
  }

  if (config["schemaVersion"] !== SCHEMA_VERSION) {
    out.push({
      path: "/schemaVersion",
      rule: "const",
      message: `schemaVersion must be ${SCHEMA_VERSION}`,
      requested: config["schemaVersion"],
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!isPlainObject(config[section])) {
      out.push({ path: `/${section}`, rule: "required", message: `Missing required section '${section}'` });
    }
  }
  if (out.length > 0) {
    collector.addAll(out);
    collector.throwIfAny("schema_invalid", "Configuration is structurally invalid");
  }

  const cfg = config as unknown as SchemaV1Config;

  // sdk identity
  if (typeof cfg.sdk.projectId !== "string" || cfg.sdk.projectId.length === 0) {
    out.push({ path: "/sdk/projectId", rule: "required", message: "sdk.projectId must be a non-empty string" });
  }
  if (typeof cfg.sdk.environment !== "string" || cfg.sdk.environment.length === 0) {
    out.push({ path: "/sdk/environment", rule: "required", message: "sdk.environment must be a non-empty string" });
  }

  // features + killswitches
  for (const key of FEATURE_KEYS) checkBoolean(`/features/${key}`, cfg.features[key], out);
  for (const key of KILLSWITCH_KEYS) checkBoolean(`/killswitches/${key}`, cfg.killswitches[key], out);

  // sampling
  for (const signal of SAMPLING_SIGNALS) checkSamplingRate(`/sampling/${signal}`, cfg.sampling[signal], out);
  if (!Array.isArray(cfg.sampling.routeOverrides)) {
    out.push({ path: "/sampling/routeOverrides", rule: "type", message: "routeOverrides must be an array" });
  } else {
    cfg.sampling.routeOverrides.forEach((entry, index) => checkRouteOverride(index, entry, out));
  }

  // instrumentation
  for (const integration of INTEGRATION_KEYS) {
    const node = cfg.instrumentation[integration];
    if (!isPlainObject(node)) {
      out.push({ path: `/instrumentation/${integration}`, rule: "type", message: "Integration must be an object" });
      continue;
    }
    checkBoolean(`/instrumentation/${integration}/enabled`, node["enabled"], out);
  }

  // privacy
  for (const key of PRIVACY_CAPTURE_KEYS) checkBoolean(`/privacy/capture/${key}`, cfg.privacy.capture?.[key], out);
  for (const key of PRIVACY_PII_KEYS) checkBoolean(`/privacy/pii/${key}`, cfg.privacy.pii?.[key], out);
  checkStringArray("/privacy/scrubbing/headers", cfg.privacy.scrubbing?.headers, out);
  checkStringArray("/privacy/scrubbing/fields", cfg.privacy.scrubbing?.fields, out);

  // limits
  checkNumber("/limits/maxSpansPerTrace", cfg.limits.maxSpansPerTrace, BOUNDS["limits.maxSpansPerTrace"], out);
  checkNumber("/limits/maxSpanAttributes", cfg.limits.maxSpanAttributes, BOUNDS["limits.maxSpanAttributes"], out);
  checkNumber("/limits/maxAttributeLength", cfg.limits.maxAttributeLength, BOUNDS["limits.maxAttributeLength"], out);
  checkNumber("/limits/maxPayloadSize", cfg.limits.maxPayloadSize, BOUNDS["limits.maxPayloadSize"], out);
  checkNumber("/limits/maxQueueSize", cfg.limits.maxQueueSize, BOUNDS["limits.maxQueueSize"], out);
  checkNumber("/limits/maxMemoryMb", cfg.limits.maxMemoryMb, BOUNDS["limits.maxMemoryMb"], out);
  checkNumber("/limits/maxCpuOverheadPercent", cfg.limits.maxCpuOverheadPercent, BOUNDS["limits.maxCpuOverheadPercent"], out);
  if (cfg.limits.tenantGovernance !== undefined) {
    const tg = cfg.limits.tenantGovernance;
    for (const key of TENANT_GOVERNANCE_KEYS) {
      checkNumber(`/limits/tenantGovernance/${key}`, tg[key], BOUNDS[`tenant.${key}` as keyof typeof BOUNDS], out);
    }
    if (typeof tg.reserve === "number" && typeof tg.quota === "number" && tg.reserve > tg.quota) {
      out.push({ path: "/limits/tenantGovernance/reserve", rule: "cross_field", message: "reserve must be <= quota" });
    }
  }

  // transport
  checkNumber("/transport/retry/maxRetries", cfg.transport.retry?.maxRetries, BOUNDS["transport.retry.maxRetries"], out);
  checkNumber("/transport/retry/baseDelayMs", cfg.transport.retry?.baseDelayMs, BOUNDS["transport.retry.baseDelayMs"], out);
  checkNumber("/transport/queue/maxSize", cfg.transport.queue?.maxSize, BOUNDS["transport.queue.maxSize"], out);
  checkNumber("/transport/queue/criticalReserve", cfg.transport.queue?.criticalReserve, BOUNDS["transport.queue.criticalReserve"], out);
  checkBoolean("/transport/keepAlive", cfg.transport.keepAlive, out);
  checkNumber("/transport/connections/total", cfg.transport.connections?.total, BOUNDS["transport.connections.total"], out);
  checkNumber("/transport/connections/acquireTimeoutMs", cfg.transport.connections?.acquireTimeoutMs, BOUNDS["transport.connections.acquireTimeoutMs"], out);
  validateRoutes(cfg, out);

  // runtime
  checkNumber("/runtime/configTtlSeconds", cfg.runtime.configTtlSeconds, BOUNDS["runtime.configTtlSeconds"], out);
  checkBoolean("/runtime/staleWhileRevalidate", cfg.runtime.staleWhileRevalidate, out);

  // meta
  if (typeof cfg.meta.generatedAt !== "string") {
    out.push({ path: "/meta/generatedAt", rule: "required", message: "meta.generatedAt must be a string" });
  }
  if (typeof cfg.meta.generatedBy !== "string") {
    out.push({ path: "/meta/generatedBy", rule: "required", message: "meta.generatedBy must be a string" });
  }

  // cross-field: queue reserve and per-route batch size
  const queueMax = cfg.transport.queue?.maxSize;
  if (typeof queueMax === "number") {
    if (typeof cfg.transport.queue.criticalReserve === "number" && cfg.transport.queue.criticalReserve > queueMax) {
      out.push({ path: "/transport/queue/criticalReserve", rule: "cross_field", message: "criticalReserve must be <= queue.maxSize" });
    }
    if (typeof cfg.limits.maxQueueSize === "number" && cfg.limits.maxQueueSize > queueMax) {
      out.push({ path: "/limits/maxQueueSize", rule: "cross_field", message: "limits.maxQueueSize must be <= transport.queue.maxSize" });
    }
  }

  collector.addAll(out);
  collector.throwIfAny("schema_invalid", "Configuration failed schema-v1 validation");
}

function validateRoutes(cfg: SchemaV1Config, out: SdkConfigErrorDetail[]): void {
  const routes = cfg.transport.routes;
  if (!isPlainObject(routes)) {
    out.push({ path: "/transport/routes", rule: "type", message: "transport.routes must be an object" });
    return;
  }
  const presentKeys = Object.keys(routes);
  // Exactly the nine fixed routes — no more, no fewer.
  for (const key of ROUTE_KEYS) {
    if (!isPlainObject(routes[key])) {
      out.push({ path: `/transport/routes/${key}`, rule: "required", message: `Missing required route '${key}'` });
    }
  }
  for (const key of presentKeys) {
    if (!ROUTE_KEYS.includes(key as (typeof ROUTE_KEYS)[number])) {
      out.push({ path: `/transport/routes/${key}`, rule: "unknown", message: `Unexpected route '${key}'` });
    }
  }
  const queueMax = cfg.transport.queue?.maxSize;
  for (const key of ROUTE_KEYS) {
    const route = routes[key];
    if (!isPlainObject(route)) continue;
    const base = `/transport/routes/${key}`;
    if (typeof route["url"] !== "string" || !/^https:\/\//.test(route["url"] as string)) {
      out.push({ path: `${base}/url`, rule: "topology", message: "Route url must be a trusted https URL" });
    }
    if (typeof route["priority"] !== "number") {
      out.push({ path: `${base}/priority`, rule: "type", message: "priority must be a number" });
    }
    checkNumber(`${base}/batchSize`, route["batchSize"], BOUNDS["route.batchSize"], out);
    checkNumber(`${base}/flushIntervalMs`, route["flushIntervalMs"], BOUNDS["route.flushIntervalMs"], out);
    checkNumber(`${base}/timeoutMs`, route["timeoutMs"], BOUNDS["route.timeoutMs"], out);
    if (!COMPRESSION_MODES.includes(route["compression"] as (typeof COMPRESSION_MODES)[number])) {
      out.push({ path: `${base}/compression`, rule: "enum", message: "compression must be gzip or none" });
    }
    if (typeof route["batchSize"] === "number" && typeof queueMax === "number" && route["batchSize"] > queueMax) {
      out.push({ path: `${base}/batchSize`, rule: "cross_field", message: "batchSize must be <= transport.queue.maxSize" });
    }
  }
}
