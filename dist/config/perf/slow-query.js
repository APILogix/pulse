/**
 * PII-Safe Slow Query Logger & Rate Limiter.
 *
 * Emits structured slow query alerts without ever logging sensitive query parameter
 * values, secrets, or PII. Includes token-bucket rate limiting to prevent log flooding.
 */
import { logger } from '../logger.js';
import { env } from '../env.js';
const slowQueryLogger = logger.child({ component: 'slow-query' });
/**
 * Extracts parameter shape metadata (types and lengths) WITHOUT values to prevent PII leakage.
 */
export function getParameterShape(params) {
    if (!params || !Array.isArray(params) || params.length === 0) {
        return [];
    }
    return params.map((val) => {
        if (val === null || val === undefined)
            return 'null';
        if (typeof val === 'string')
            return `string(len=${val.length})`;
        if (typeof val === 'number')
            return 'number';
        if (typeof val === 'boolean')
            return 'boolean';
        if (val instanceof Date)
            return 'date';
        if (Buffer.isBuffer(val))
            return `buffer(${val.length}B)`;
        if (Array.isArray(val))
            return `array(len=${val.length})`;
        if (typeof val === 'object')
            return `object(keys=${Object.keys(val).length})`;
        return typeof val;
    });
}
export class SlowQueryRateLimiter {
    windows = new Map();
    maxPerMinute;
    windowMs;
    constructor(maxPerMinute = 10, windowMs = 60_000) {
        this.maxPerMinute = maxPerMinute;
        this.windowMs = windowMs;
    }
    /**
     * Checks if a slow query log should be emitted or suppressed.
     * Returns `{ shouldLog: boolean, suppressedCount: number }`.
     */
    check(queryName) {
        const now = Date.now();
        let record = this.windows.get(queryName);
        if (!record || now - record.windowStart >= this.windowMs) {
            const previouslySuppressed = record ? record.suppressedCount : 0;
            record = {
                windowStart: now,
                emittedCount: 1,
                suppressedCount: 0,
            };
            this.windows.set(queryName, record);
            return { shouldLog: true, suppressedCount: previouslySuppressed };
        }
        if (record.emittedCount < this.maxPerMinute) {
            record.emittedCount += 1;
            return { shouldLog: true, suppressedCount: 0 };
        }
        record.suppressedCount += 1;
        return { shouldLog: false, suppressedCount: record.suppressedCount };
    }
    reset() {
        this.windows.clear();
    }
}
export const defaultSlowQueryRateLimiter = new SlowQueryRateLimiter(10, 60_000);
export function getSlowQueryThreshold(db, queryName, overrides) {
    if (queryName && overrides && typeof overrides[queryName] === 'number') {
        return overrides[queryName];
    }
    const defaultControl = Number(process.env.SLOW_QUERY_CONTROL_MS || 500);
    const defaultTelemetry = Number(process.env.SLOW_QUERY_TELEMETRY_MS || 2000);
    return db === 'control' ? defaultControl : defaultTelemetry;
}
/**
 * Checks query execution time against threshold and emits a sanitized log if exceeded.
 */
export function maybeLogSlowQuery(db, queryName, durationMs, rowCount, params, context, customThresholdMs, rateLimiter = defaultSlowQueryRateLimiter) {
    const thresholdMs = customThresholdMs ?? getSlowQueryThreshold(db, queryName);
    if (durationMs < thresholdMs) {
        return false;
    }
    const { shouldLog, suppressedCount } = rateLimiter.check(queryName);
    if (!shouldLog) {
        return false;
    }
    const payload = {
        queryName,
        db,
        durationMs: Math.round(durationMs * 100) / 100,
        thresholdMs,
        rowCount,
        parameterShapes: getParameterShape(params),
        requestId: context?.requestId,
        route: context?.route,
        tier: context?.tier,
        orgId: context?.orgId,
        suppressedCount,
    };
    slowQueryLogger.warn(payload, 'Slow database query threshold exceeded');
    return true;
}
//# sourceMappingURL=slow-query.js.map