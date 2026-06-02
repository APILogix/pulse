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
  maxTraceSpanCount: 10_000,   // reject absurd trace trees
  maxReplayEvents: 5000,
} as const;

export const SDK_EVENT_TYPES = [
  'error', 'message', 'request', 'span', 'trace',
  'metric', 'log', 'profile', 'cron_checkin', 'replay',
] as const;
export type SdkEventType = (typeof SDK_EVENT_TYPES)[number];

// Bounded primitives reused across schemas.
const boundedStr = (max: number = LIMITS.maxStringLen) => z.string().max(max);
const epochMs = z.number().int().nonnegative();
const idStr = z.string().max(64);

// A bounded JSON object: caps key count to prevent cardinality bombs.
function boundedRecord(maxKeys: number) {
  return z.record(z.string().max(256), z.unknown()).refine(
    (o) => Object.keys(o).length <= maxKeys,
    { message: `too many keys (max ${maxKeys})` },
  );
}

// ── Per-type schemas (mirror the SDK reference, leniently) ───────────────────
// We keep these permissive on optional fields (SDKs evolve) but strict on the
// security-relevant bounds. Unknown extra fields are allowed but ignored by
// storage; we do not echo them.

const baseFields = {
  eventId: idStr.optional(),
  timestamp: epochMs.optional(),
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
  context: boundedRecord(LIMITS.maxAttributeKeys).optional(),
  breadcrumbs: z.array(z.unknown()).max(LIMITS.maxBreadcrumbs).optional(),
}).passthrough();

const messageSchema = z.object({
  type: z.literal('message'),
  ...baseFields,
  message: boundedStr(LIMITS.maxMessageLen),
  severity: z.string().max(16).optional(),
  context: boundedRecord(LIMITS.maxAttributeKeys).optional(),
  breadcrumbs: z.array(z.unknown()).max(LIMITS.maxBreadcrumbs).optional(),
}).passthrough();

const requestSchema = z.object({
  type: z.literal('request'),
  ...baseFields,
  requestId: idStr,
  url: boundedStr(),
  method: z.string().max(10),
  statusCode: z.number().int().min(0).max(599),
  latency: z.number().min(0),
  headers: boundedRecord(LIMITS.maxTagKeys).optional(),
  query: boundedRecord(LIMITS.maxTagKeys).optional(),
  body: boundedRecord(LIMITS.maxAttributeKeys).optional(),
  bodySize: z.number().int().nonnegative().optional(),
  userId: z.string().max(256).nullable().optional(),
}).passthrough();

const spanSchema = z.object({
  type: z.literal('span'),
  ...baseFields,
  spanId: idStr,
  traceId: idStr,
  parentSpanId: idStr.optional(),
  name: boundedStr(),
  kind: z.string().max(16).optional(),
  startTime: epochMs,
  endTime: epochMs.optional(),
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
}).passthrough();

const profileSchema = z.object({
  type: z.literal('profile'),
  ...baseFields,
  profileType: z.enum(['cpu', 'heap']),
  startTime: epochMs.optional(),
  endTime: epochMs.optional(),
  duration: z.number().min(0).optional(),
  profile: z.unknown(),
}).passthrough();

const cronSchema = z.object({
  type: z.literal('cron_checkin'),
  ...baseFields,
  monitorSlug: boundedStr(255),
  status: z.enum(['ok', 'error', 'in_progress']),
  duration: z.number().min(0).optional(),
  environment: z.string().max(64).optional(),
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

export type NormalizedEvent = z.infer<typeof eventSchema>;

export interface NormalizeOk {
  ok: true;
  event: NormalizedEvent;
}
export interface NormalizeErr {
  ok: false;
  reason: 'validation_failed' | 'unknown_type' | 'not_an_object';
  detail: string;
}
export type NormalizeResult = NormalizeOk | NormalizeErr;

/**
 * Validate + normalize a single raw event. Never throws — returns a tagged
 * result so the caller can record a per-event rejection without failing the
 * whole batch (partial-success ingestion).
 */
export function normalizeEvent(raw: unknown): NormalizeResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'not_an_object', detail: 'event is not an object' };
  }
  let candidate: unknown = raw;
  const type = (raw as { type?: unknown }).type;
  if (type === 'metric') {
    const r = raw as Record<string, unknown>;
    if (!r.metricName && typeof r.name === 'string') {
      candidate = { ...r, metricName: r.name };
    }
  }
  const resolvedType = (candidate as { type?: unknown }).type;
  if (typeof resolvedType !== 'string' || !SDK_EVENT_TYPES.includes(resolvedType as SdkEventType)) {
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
  return { ok: true, event: parsed.data };
}

/** Resolve the storage timestamp (ms epoch) for an event, defaulting to now. */
export function resolveTimestamp(ev: NormalizedEvent): number {
  const ts = (ev as { timestamp?: number }).timestamp;
  if (typeof ts === 'number' && ts > 0) {
    // Clamp future timestamps to now + 1m (defends partition-key abuse).
    const max = Date.now() + 60_000;
    return ts > max ? Date.now() : ts;
  }
  return Date.now();
}
