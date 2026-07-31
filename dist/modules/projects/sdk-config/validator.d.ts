import { type SdkConfigErrorDetail } from "./errors.js";
import { type SchemaV1Config } from "./schema-v1.js";
export interface NumericBound {
    min: number;
    max: number;
    integer: boolean;
    maxDecimals?: number;
}
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
    readonly "transport.connections.maxTotalConnections": {
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
        readonly min: 0;
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
    readonly "tenant.quotaPerWindow": {
        readonly min: 1;
        readonly max: 1000000;
        readonly integer: true;
    };
    readonly "tenant.windowDurationMs": {
        readonly min: 1000;
        readonly max: 3600000;
        readonly integer: true;
    };
    readonly "tenant.criticalReserve": {
        readonly min: 0;
        readonly max: 100000;
        readonly integer: true;
    };
};
export declare const SAMPLING_RATE_BOUND: NumericBound;
export declare const MAX_SAMPLING_ROUTES = 1000;
export declare const MAX_ROUTE_PATH_BYTES = 512;
export declare const MAX_SCRUB_PATTERNS = 500;
export declare const MAX_PATTERN_BYTES = 512;
export declare function validateEditableLeaf(segments: string[], value: unknown): SdkConfigErrorDetail[];
/** Validate the exact wire contract. Unknown and legacy fields are rejected. */
export declare function validateSchemaV1(config: unknown): asserts config is SchemaV1Config;
//# sourceMappingURL=validator.d.ts.map