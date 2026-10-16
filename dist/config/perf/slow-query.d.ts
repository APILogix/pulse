/**
 * PII-Safe Slow Query Logger & Rate Limiter.
 *
 * Emits structured slow query alerts without ever logging sensitive query parameter
 * values, secrets, or PII. Includes token-bucket rate limiting to prevent log flooding.
 */
import type { DbQueryName } from './query-names.js';
import type { RequestPerfStats } from './context.js';
export interface SlowQueryLogPayload {
    queryName: DbQueryName | string;
    db: 'control' | 'telemetry';
    durationMs: number;
    thresholdMs: number;
    rowCount?: number | undefined;
    parameterShapes: string[];
    requestId?: string | undefined;
    route?: string | undefined;
    tier?: string | undefined;
    orgId?: string | undefined;
    suppressedCount: number;
}
/**
 * Extracts parameter shape metadata (types and lengths) WITHOUT values to prevent PII leakage.
 */
export declare function getParameterShape(params?: unknown[]): string[];
export declare class SlowQueryRateLimiter {
    private readonly windows;
    private readonly maxPerMinute;
    private readonly windowMs;
    constructor(maxPerMinute?: number, windowMs?: number);
    /**
     * Checks if a slow query log should be emitted or suppressed.
     * Returns `{ shouldLog: boolean, suppressedCount: number }`.
     */
    check(queryName: string): {
        shouldLog: boolean;
        suppressedCount: number;
    };
    reset(): void;
}
export declare const defaultSlowQueryRateLimiter: SlowQueryRateLimiter;
export declare function getSlowQueryThreshold(db: 'control' | 'telemetry', queryName?: string, overrides?: Record<string, number>): number;
/**
 * Checks query execution time against threshold and emits a sanitized log if exceeded.
 */
export declare function maybeLogSlowQuery(db: 'control' | 'telemetry', queryName: DbQueryName | string, durationMs: number, rowCount?: number, params?: unknown[], context?: RequestPerfStats, customThresholdMs?: number, rateLimiter?: SlowQueryRateLimiter): boolean;
//# sourceMappingURL=slow-query.d.ts.map