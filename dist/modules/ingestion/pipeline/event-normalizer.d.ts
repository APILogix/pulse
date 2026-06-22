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
export declare const LIMITS: {
    readonly maxStringLen: 8192;
    readonly maxMessageLen: 4096;
    readonly maxArrayItems: 1000;
    readonly maxTagKeys: 100;
    readonly maxAttributeKeys: 200;
    readonly maxStackFrames: 200;
    readonly maxBreadcrumbs: 100;
    readonly maxTraceSpanCount: 10000;
    readonly maxReplayEvents: 5000;
};
export declare const SDK_EVENT_TYPES: readonly ["error", "message", "request", "span", "trace", "metric", "log", "profile", "cron_checkin", "replay"];
export type SdkEventType = (typeof SDK_EVENT_TYPES)[number];
export declare const eventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    message: z.ZodString;
    name: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>]>>;
    stack: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    fingerprint: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    breadcrumbs: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"error">;
}, z.core.$loose>, z.ZodObject<{
    message: z.ZodString;
    severity: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    breadcrumbs: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"message">;
}, z.core.$loose>, z.ZodObject<{
    requestId: z.ZodString;
    url: z.ZodString;
    method: z.ZodString;
    statusCode: z.ZodNumber;
    latency: z.ZodNumber;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    query: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    body: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    bodySize: z.ZodOptional<z.ZodNumber>;
    userId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"request">;
}, z.core.$loose>, z.ZodObject<{
    spanId: z.ZodString;
    traceId: z.ZodString;
    parentSpanId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    kind: z.ZodOptional<z.ZodString>;
    startTime: z.ZodNumber;
    endTime: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodOptional<z.ZodNumber>;
    exclusiveDuration: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodString>;
    statusMessage: z.ZodOptional<z.ZodString>;
    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    events: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    links: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"span">;
}, z.core.$loose>, z.ZodObject<{
    traceId: z.ZodString;
    rootSpan: z.ZodUnknown;
    spanCount: z.ZodNumber;
    totalDuration: z.ZodOptional<z.ZodNumber>;
    isPartial: z.ZodOptional<z.ZodBoolean>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"trace">;
}, z.core.$loose>, z.ZodObject<{
    metricName: z.ZodString;
    metricType: z.ZodEnum<{
        counter: "counter";
        gauge: "gauge";
        histogram: "histogram";
    }>;
    value: z.ZodOptional<z.ZodNumber>;
    unit: z.ZodOptional<z.ZodString>;
    count: z.ZodOptional<z.ZodNumber>;
    sum: z.ZodOptional<z.ZodNumber>;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
    avg: z.ZodOptional<z.ZodNumber>;
    buckets: z.ZodOptional<z.ZodUnknown>;
    tags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"metric">;
}, z.core.$loose>, z.ZodObject<{
    level: z.ZodString;
    message: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"log">;
}, z.core.$loose>, z.ZodObject<{
    profileType: z.ZodEnum<{
        cpu: "cpu";
        heap: "heap";
    }>;
    startTime: z.ZodOptional<z.ZodNumber>;
    endTime: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodOptional<z.ZodNumber>;
    profile: z.ZodUnknown;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"profile">;
}, z.core.$loose>, z.ZodObject<{
    monitorSlug: z.ZodString;
    status: z.ZodEnum<{
        error: "error";
        ok: "ok";
        in_progress: "in_progress";
    }>;
    duration: z.ZodOptional<z.ZodNumber>;
    environment: z.ZodOptional<z.ZodString>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"cron_checkin">;
}, z.core.$loose>, z.ZodObject<{
    sessionId: z.ZodString;
    segmentId: z.ZodNumber;
    events: z.ZodArray<z.ZodUnknown>;
    eventId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodNumber>;
    requestId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    spanId: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"replay">;
}, z.core.$loose>], "type">;
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
export declare function normalizeEvent(raw: unknown): NormalizeResult;
/** Resolve the storage timestamp (ms epoch) for an event, defaulting to now. */
export declare function resolveTimestamp(ev: NormalizedEvent): number;
//# sourceMappingURL=event-normalizer.d.ts.map