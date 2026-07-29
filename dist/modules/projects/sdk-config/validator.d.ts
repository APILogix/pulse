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
import { type SdkConfigErrorDetail } from "./errors.js";
import { type SchemaV1Config } from "./schema-v1.js";
export interface NumericBound {
    min: number;
    max: number;
    integer: boolean;
    maxDecimals?: number;
}
/** Inclusive server hard bounds (design.md §9). Policy may narrow, never widen. */
export declare const BOUNDS: {
    readonly "limits.maxSpansPerTrace": {
        readonly min: 1;
        readonly max: 5000;
        readonly integer: true;
    };
    readonly "limits.maxSpanAttributes": {
        readonly min: 1;
        readonly max: 500;
        readonly integer: true;
    };
    readonly "limits.maxAttributeLength": {
        readonly min: 1;
        readonly max: 16384;
        readonly integer: true;
    };
    readonly "limits.maxPayloadSize": {
        readonly min: 1024;
        readonly max: 4194304;
        readonly integer: true;
    };
    readonly "limits.maxQueueSize": {
        readonly min: 1;
        readonly max: 100000;
        readonly integer: true;
    };
    readonly "limits.maxMemoryMb": {
        readonly min: 16;
        readonly max: 1024;
        readonly integer: true;
    };
    readonly "limits.maxCpuOverheadPercent": {
        readonly min: 0.1;
        readonly max: 25;
        readonly integer: false;
        readonly maxDecimals: 3;
    };
    readonly "transport.retry.maxRetries": {
        readonly min: 0;
        readonly max: 10;
        readonly integer: true;
    };
    readonly "transport.retry.baseDelayMs": {
        readonly min: 100;
        readonly max: 30000;
        readonly integer: true;
    };
    readonly "transport.queue.maxSize": {
        readonly min: 1;
        readonly max: 100000;
        readonly integer: true;
    };
    readonly "transport.queue.criticalReserve": {
        readonly min: 0;
        readonly max: 100000;
        readonly integer: true;
    };
    readonly "transport.connections.total": {
        readonly min: 1;
        readonly max: 500;
        readonly integer: true;
    };
    readonly "transport.connections.acquireTimeoutMs": {
        readonly min: 100;
        readonly max: 60000;
        readonly integer: true;
    };
    readonly "runtime.configTtlSeconds": {
        readonly min: 30;
        readonly max: 86400;
        readonly integer: true;
    };
    readonly "route.batchSize": {
        readonly min: 1;
        readonly max: 5000;
        readonly integer: true;
    };
    readonly "route.flushIntervalMs": {
        readonly min: 100;
        readonly max: 300000;
        readonly integer: true;
    };
    readonly "route.timeoutMs": {
        readonly min: 250;
        readonly max: 60000;
        readonly integer: true;
    };
    readonly "tenant.maxTenantsTracked": {
        readonly min: 1;
        readonly max: 100000;
        readonly integer: true;
    };
    readonly "tenant.quota": {
        readonly min: 1;
        readonly max: 1000000;
        readonly integer: true;
    };
    readonly "tenant.windowMs": {
        readonly min: 1000;
        readonly max: 3600000;
        readonly integer: true;
    };
    readonly "tenant.reserve": {
        readonly min: 0;
        readonly max: 100000;
        readonly integer: true;
    };
};
export declare const SAMPLING_RATE_BOUND: NumericBound;
export declare const MAX_ROUTE_OVERRIDES = 1000;
export declare const MAX_PREFIX_BYTES = 512;
export declare const MAX_SCRUB_PATTERNS = 500;
export declare const MAX_PATTERN_BYTES = 512;
/**
 * Validate a single editable leaf's value (type + bounds). `segments` are the
 * classified-editable reference tokens; `value` is the intended value. Returns
 * detail records (empty when valid). Does NOT perform cross-field checks.
 */
export declare function validateEditableLeaf(segments: string[], value: unknown): SdkConfigErrorDetail[];
/**
 * Validate a complete compiled schema-v1 document. Throws a 422 SdkConfigError
 * with pointer-level details when anything is missing, mistyped, out of range,
 * or violates a cross-field invariant. This is the authoritative gate that the
 * compiler output and the delivery document must pass (design.md §9).
 */
export declare function validateSchemaV1(config: unknown): asserts config is SchemaV1Config;
//# sourceMappingURL=validator.d.ts.map