/**
 * Event normalization + validation layer.
 *
 * This is the security boundary for telemetry. Every event the SDK sends is
 * UNTRUSTED. Before anything is queued or stored we:
 *   1. Validate the discriminated union by `type` against a strict Zod schema.
 *   2. Bound every string/array/object so a malicious or buggy SDK cannot DoS
 *      us with giant payloads, deep nesting, or cardinality explosions.
 *   3. Strip/normalize fields so downstream storage code can trust shapes.
 *
 * Threats explicitly handled here:
 *   - giant payload DoS        -> per-field length caps + array caps
 *   - telemetry poisoning      -> reject events whose type/shape is invalid
 *   - cardinality explosion    -> cap tag/attribute counts
 *   - infinite trace chains    -> cap span tree depth / span count
 *   - malformed SDK output     -> schema validation, never throw to caller
 *
 * Output is a NormalizedEvent: a safe, type-tagged, size-bounded object the
 * queue + workers can persist without re-validating.
 */
import { z } from 'zod';
// ── Hard limits (DoS protection) ────────────────────────────────────────────
export const LIMITS = {
    maxStringLen: 8192,
    maxMessageLen: 4096,
    maxArrayItems: 1000,
    maxTagKeys: 100,
    maxAttributeKeys: 200,
    maxStackFrames: 200,
    maxBreadcrumbs: 100,
    maxTraceSpanCount: 10_000, // reject absurd trace trees
    maxTraceSpanDepth: 128, // root is depth 0; reject depth > 128
    maxReplayEvents: 5000,
};
export const SDK_EVENT_TYPES = [
    'error', 'message', 'request', 'span', 'trace',
    'metric', 'log', 'profile', 'cron_checkin', 'replay',
];
/** SDK-supplied telemetry environment. Never substitute a credential UUID or server-derived slug. */
export const SDK_ENVIRONMENT_MAX_LENGTH = 64;
const SDK_ENVIRONMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function normalizeSdkEnvironment(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    if (normalized.length === 0 ||
        normalized.length > SDK_ENVIRONMENT_MAX_LENGTH ||
        !SDK_ENVIRONMENT_PATTERN.test(normalized)) {
        return null;
    }
    return normalized;
}
// Bounded primitives reused across schemas.
const boundedStr = (max = LIMITS.maxStringLen) => z.string().max(max);
const idStr = z.string().max(64);
const MAX_FUTURE_SKEW_MS = 60_000;
const timestampMs = z.preprocess((value) => {
    // Parse units and shapes here, but defer future-skew clamping until
    // normalizeEvent() receives the immutable gateway receipt timestamp. Using
    // Date.now() inside the schema made retries of the same pg-boss payload
    // normalize to different values.
    const ms = parseSafeEpochMs(value);
    return ms ?? value;
}, z.number().int().nonnegative());
// A bounded JSON object: caps key count to prevent cardinality bombs.
function boundedRecord(maxKeys) {
    return z.record(z.string().max(256), z.unknown()).refine((o) => Object.keys(o).length <= maxKeys, { message: `too many keys (max ${maxKeys})` });
}
// ── Per-type schemas (mirror the SDK reference, leniently) ───────────────────
// We keep these permissive on optional fields (SDKs evolve) but strict on the
// security-relevant bounds. Unknown extra fields are allowed but ignored by
// storage; we do not echo them.
const baseFields = {
    eventId: idStr.optional(),
    timestamp: timestampMs.optional(),
    requestId: idStr.optional(),
    traceId: idStr.optional(),
    spanId: idStr.optional(),
    sessionId: idStr.optional(),
};
const errorSchema = z.object({
    type: z.literal('error'),
    ...baseFields,
    message: boundedStr(LIMITS.maxMessageLen),
    name: z.union([boundedStr(256), z.record(z.string(), z.unknown())]).optional(),
    stack: z.array(z.unknown()).max(LIMITS.maxStackFrames).optional(),
    fingerprint: boundedStr(128).optional(),
    severity: z.string().max(16).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    statusText: boundedStr(128).optional(),
    handled: z.boolean().optional(),
    method: z.string().max(10).optional(),
    route: boundedStr(2048).optional(),
    url: boundedStr(8192).optional(),
    context: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    breadcrumbs: z.array(z.unknown()).max(LIMITS.maxBreadcrumbs).optional(),
}).passthrough();
const messageSchema = z.object({
    type: z.literal('message'),
    ...baseFields,
    message: boundedStr(LIMITS.maxMessageLen),
    severity: z.string().max(16).optional(),
    name: boundedStr(256).optional(),
    tenantId: idStr.optional(),
    loggerName: boundedStr(128).optional(),
    endpoint: boundedStr(8192).optional(),
    statusCode: z.number().int().min(0).max(599).optional(),
    attributes: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    tags: z.record(z.string().max(256), z.string().max(1024))
        .refine((o) => Object.keys(o).length <= LIMITS.maxTagKeys, 'too many tags')
        .optional(),
    context: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    breadcrumbs: z.array(z.unknown()).max(LIMITS.maxBreadcrumbs).optional(),
}).passthrough();
const requestSchema = z.object({
    type: z.literal('request'),
    ...baseFields,
    requestId: idStr,
    parentSpanId: idStr.optional(),
    url: boundedStr(),
    route: boundedStr(2048).optional(),
    method: z.string().max(10),
    statusCode: z.number().int().min(0).max(599),
    latency: z.number().min(0),
    headers: boundedRecord(LIMITS.maxTagKeys).optional(),
    query: boundedRecord(LIMITS.maxTagKeys).optional(),
    body: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    bodySize: z.number().int().nonnegative().optional(),
    responseSize: z.number().int().nonnegative().optional(),
    userId: z.string().max(256).nullable().optional(),
    tenantId: idStr.optional(),
    user: z.record(z.string().max(256), z.unknown()).optional(),
    tags: z.record(z.string().max(256), z.unknown()).optional(),
    extra: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    metadata: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    service: boundedStr(100).optional(),
    framework: boundedStr(50).optional(),
    release: boundedStr(100).optional(),
    serverName: boundedStr(100).optional(),
    sdkName: boundedStr(50).optional(),
    sdkVersion: boundedStr(50).optional(),
    spanCount: z.number().int().nonnegative().optional(),
    rootSpanStatus: boundedStr(32).optional(),
    isPartial: z.boolean().optional(),
}).passthrough();
const spanSchema = z.object({
    type: z.literal('span'),
    ...baseFields,
    spanId: idStr,
    traceId: idStr,
    parentSpanId: idStr.optional(),
    name: boundedStr(),
    kind: z.string().max(16).optional(),
    startTime: timestampMs,
    endTime: timestampMs.optional(),
    duration: z.number().min(0).optional(),
    exclusiveDuration: z.number().optional(),
    status: z.string().max(16).optional(),
    statusMessage: boundedStr().optional(),
    attributes: boundedRecord(LIMITS.maxAttributeKeys).optional(),
    events: z.array(z.unknown()).max(LIMITS.maxArrayItems).optional(),
    links: z.array(z.unknown()).max(LIMITS.maxArrayItems).optional(),
}).passthrough();
const traceSchema = z.object({
    type: z.literal('trace'),
    ...baseFields,
    traceId: idStr,
    rootSpan: z.unknown(),
    spanCount: z.number().int().min(0).max(LIMITS.maxTraceSpanCount),
    totalDuration: z.number().min(0).optional(),
    isPartial: z.boolean().optional(),
}).passthrough();
const metricSchema = z.object({
    type: z.literal('metric'),
    ...baseFields,
    metricName: boundedStr(255),
    metricType: z.enum(['counter', 'gauge', 'histogram']),
    value: z.number().optional(),
    unit: z.string().max(32).optional(),
    count: z.number().optional(),
    sum: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    avg: z.number().optional(),
    buckets: z.unknown().optional(),
    tags: z.record(z.string().max(256), z.string().max(1024))
        .refine((o) => Object.keys(o).length <= LIMITS.maxTagKeys, 'too many tags')
        .optional(),
}).passthrough();
const logSchema = z.object({
    type: z.literal('log'),
    ...baseFields,
    level: z.string().max(16),
    message: boundedStr(LIMITS.maxMessageLen),
    args: z.array(z.unknown()).max(10).optional(),
    // Enterprise fields
    parentSpanId: idStr.optional(),
    tenantId: idStr.optional(),
    name: boundedStr(255).optional(),
    loggerName: boundedStr(255).optional(),
    logSource: z.enum(['sdk', 'console', 'framework', 'middleware', 'application', 'worker', 'cron', 'queue', 'unknown']).optional(),
    logCategory: z.enum(['http', 'application', 'database', 'cache', 'queue', 'worker', 'cron', 'security', 'authentication', 'authorization', 'business', 'system', 'runtime', 'custom', 'unknown']).optional(),
    endpoint: boundedStr(2048).optional(),
    httpMethod: z.string().max(16).optional(),
    statusCode: z.number().int().optional(),
    durationMs: z.number().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string().max(256), z.string().max(1024)).optional(),
    attributes: boundedRecord(LIMITS.maxAttributeKeys).optional(),
}).passthrough();
const profileSchema = z.object({
    type: z.literal('profile'),
    ...baseFields,
    profileType: z.enum(['cpu', 'heap']),
    startTime: timestampMs.optional(),
    endTime: timestampMs.optional(),
    duration: z.number().min(0).optional(),
    profile: z.unknown(),
}).passthrough();
const cronSchema = z.object({
    type: z.literal('cron_checkin'),
    ...baseFields,
    monitorSlug: boundedStr(255),
    monitorName: boundedStr(255).optional(),
    status: z.enum(['ok', 'error', 'in_progress', 'failed', 'timeout', 'missed']),
    duration: z.number().min(0).optional(),
    environment: z.string().max(64).optional(),
    // Correlation / multi-tenancy
    tenantId: idStr.optional(),
    // Execution timeline
    startedAt: timestampMs.optional(),
    finishedAt: timestampMs.optional(),
    // Classification (auto-derived if not supplied)
    checkinType: z.enum(['heartbeat', 'scheduled', 'manual', 'retry', 'unknown']).optional(),
    scheduleType: z.string().max(64).optional(),
    // Flexible custom data
    tags: z.record(z.string().max(256), z.string().max(1024)).optional(),
    attributes: boundedRecord(LIMITS.maxAttributeKeys).optional(),
}).passthrough();
const replaySchema = z.object({
    type: z.literal('replay'),
    ...baseFields,
    sessionId: idStr,
    segmentId: z.number().int().nonnegative(),
    events: z.array(z.unknown()).max(LIMITS.maxReplayEvents),
}).passthrough();
export const eventSchema = z.discriminatedUnion('type', [
    errorSchema, messageSchema, requestSchema, spanSchema, traceSchema,
    metricSchema, logSchema, profileSchema, cronSchema, replaySchema,
]);
const TOP_LEVEL_TIMESTAMP_KEYS = [
    'timestamp', 'startTime', 'start_time', 'endTime', 'end_time',
    'startedAt', 'started_at', 'finishedAt', 'finished_at',
];
const TRACE_SPAN_TIMESTAMP_KEYS = new Set([
    'timestamp', 'startTime', 'start_time', 'endTime', 'end_time',
    'time', 'start', 'end',
]);
function clockEpochMs(raw) {
    return parseSafeEpochMs(raw) ?? Date.now();
}
function normalizeTopLevelTimestamps(event, nowMs) {
    const source = event;
    const normalized = { ...source };
    for (const key of TOP_LEVEL_TIMESTAMP_KEYS) {
        if (!(key in source))
            continue;
        const value = normalizeTimestampToEpochMs(source[key], nowMs);
        if (value !== null)
            normalized[key] = value;
    }
    return normalized;
}
function isPlainTraceSpan(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/**
 * Validate and clone a trace tree without recursion. The discovered-node count
 * bounds allocation before child arrays are cloned, and the WeakSet rejects
 * cycles as well as shared span objects (both violate the tree contract).
 */
function normalizeTraceSpanTree(rootSpan, nowMs) {
    if (!isPlainTraceSpan(rootSpan)) {
        return { ok: false, detail: 'rootSpan must be a plain object' };
    }
    const normalizedRoot = Object.create(null);
    const discovered = new WeakSet();
    discovered.add(rootSpan);
    let nodeCount = 1;
    const stack = [{ source: rootSpan, target: normalizedRoot, depth: 0 }];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current.depth > LIMITS.maxTraceSpanDepth) {
            return {
                ok: false,
                detail: `rootSpan exceeds maximum depth ${LIMITS.maxTraceSpanDepth}`,
            };
        }
        for (const [key, value] of Object.entries(current.source)) {
            if (key === 'children')
                continue;
            if (TRACE_SPAN_TIMESTAMP_KEYS.has(key)) {
                const timestamp = normalizeTimestampToEpochMs(value, nowMs);
                current.target[key] = timestamp ?? value;
            }
            else {
                current.target[key] = value;
            }
        }
        const children = Object.prototype.hasOwnProperty.call(current.source, 'children')
            ? current.source.children
            : undefined;
        if (children === undefined)
            continue;
        if (!Array.isArray(children)) {
            return {
                ok: false,
                detail: `rootSpan children at depth ${current.depth} must be an array`,
            };
        }
        if (children.length === 0) {
            current.target.children = [];
            continue;
        }
        if (current.depth >= LIMITS.maxTraceSpanDepth) {
            return {
                ok: false,
                detail: `rootSpan exceeds maximum depth ${LIMITS.maxTraceSpanDepth}`,
            };
        }
        if (nodeCount + children.length > LIMITS.maxTraceSpanCount) {
            return {
                ok: false,
                detail: `rootSpan exceeds maximum node count ${LIMITS.maxTraceSpanCount}`,
            };
        }
        // Validate and reserve every child before allocating the cloned array.
        for (const child of children) {
            if (!isPlainTraceSpan(child)) {
                return {
                    ok: false,
                    detail: `rootSpan child at depth ${current.depth + 1} must be a plain object`,
                };
            }
            if (discovered.has(child)) {
                return {
                    ok: false,
                    detail: 'rootSpan must be a tree; cycles and shared span references are not allowed',
                };
            }
            discovered.add(child);
        }
        nodeCount += children.length;
        const normalizedChildren = children.map(() => Object.create(null));
        current.target.children = normalizedChildren;
        // LIFO traversal is reversed so output and validation preserve SDK order.
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push({
                source: children[index],
                target: normalizedChildren[index],
                depth: current.depth + 1,
            });
        }
    }
    return { ok: true, rootSpan: normalizedRoot, nodeCount };
}
/**
 * Validate + normalize a single raw event. Never throws — returns a tagged
 * result so the caller can record a per-event rejection without failing the
 * whole batch (partial-success ingestion).
 */
export function normalizeEvent(raw, options = {}) {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, reason: 'not_an_object', detail: 'event is not an object' };
    }
    let candidate = raw;
    const type = raw.type;
    if (type === 'metric') {
        const r = raw;
        if (!r.metricName && typeof r.name === 'string') {
            candidate = { ...r, metricName: r.name };
        }
    }
    const resolvedType = candidate.type;
    if (typeof resolvedType !== 'string' || !SDK_EVENT_TYPES.includes(resolvedType)) {
        return { ok: false, reason: 'unknown_type', detail: `unknown event type: ${String(resolvedType)}` };
    }
    const parsed = eventSchema.safeParse(candidate);
    if (!parsed.success) {
        return {
            ok: false,
            reason: 'validation_failed',
            detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
    }
    const nowMs = clockEpochMs(options.nowMs);
    let event = normalizeTopLevelTimestamps(parsed.data, nowMs);
    if (event.type === 'trace') {
        const traceTree = normalizeTraceSpanTree(event.rootSpan, nowMs);
        if (!traceTree.ok) {
            return { ok: false, reason: 'validation_failed', detail: traceTree.detail };
        }
        event = { ...event, rootSpan: traceTree.rootSpan };
    }
    return { ok: true, event };
}
/** Normalize a supported SDK timestamp shape into canonical epoch milliseconds. */
export function normalizeTimestampToEpochMs(raw, nowMs = Date.now()) {
    const ms = parseSafeEpochMs(raw);
    if (ms === null)
        return null;
    const now = clockEpochMs(nowMs);
    return Math.round(ms > now + MAX_FUTURE_SKEW_MS ? now : ms);
}
/** Parse raw timestamp input (number, string, Date) to safe epoch milliseconds. */
export function parseSafeEpochMs(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || Number.isNaN(raw)) {
            return null;
        }
        // Unix epoch scale detection:
        // Milliseconds: ~1e11 to ~1e14 (e.g. 1786963046732 or 1786963046966.2644)
        if (raw >= 1e11 && raw <= 1e14) {
            return Math.round(raw);
        }
        // Seconds: ~1e9 to ~1e11 (e.g. 1786963046)
        if (raw >= 1e9 && raw < 1e11) {
            return Math.round(raw * 1000);
        }
        // Microseconds: ~1e14 to ~1e17 (e.g. 1786963046732000)
        if (raw > 1e14 && raw <= 1e17) {
            return Math.round(raw / 1000);
        }
        // Nanoseconds: ~1e17 to ~1e20 (e.g. 1786963046732000000)
        if (raw > 1e17 && raw <= 1e20) {
            return Math.round(raw / 1_000_000);
        }
        // Small ms or relative offset
        if (raw >= 0 && raw < 1e9) {
            return Math.round(raw);
        }
        return null;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.length === 0)
            return null;
        const numVal = Number(trimmed);
        if (Number.isFinite(numVal) && !Number.isNaN(numVal)) {
            return parseSafeEpochMs(numVal);
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed) && !Number.isNaN(parsed)) {
            return parsed;
        }
        return null;
    }
    if (raw instanceof Date) {
        const t = raw.getTime();
        return Number.isFinite(t) && !Number.isNaN(t) ? t : null;
    }
    return null;
}
/** Resolve the storage timestamp (ms epoch), using a caller-supplied stable fallback when available. */
export function resolveTimestamp(ev, options = {}) {
    const nowMs = clockEpochMs(options.nowMs);
    const rootSpan = ev.rootSpan;
    const root = rootSpan && typeof rootSpan === 'object' && !Array.isArray(rootSpan)
        ? rootSpan
        : null;
    const raw = ev.timestamp
        ?? ev.startTime
        ?? ev.start_time
        ?? root?.startTime
        ?? root?.start_time
        ?? root?.timestamp;
    if (raw != null) {
        const ms = normalizeTimestampToEpochMs(raw, nowMs);
        if (ms != null && ms > 0) {
            return ms;
        }
    }
    const fallbackMs = normalizeTimestampToEpochMs(options.fallbackMs, nowMs);
    return fallbackMs != null && fallbackMs > 0 ? fallbackMs : nowMs;
}
//# sourceMappingURL=event-normalizer.js.map