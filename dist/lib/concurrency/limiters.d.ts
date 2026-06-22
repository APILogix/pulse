export declare const globalDbLimit: import("p-limit").LimitFunction;
export declare const globalApiLimit: import("p-limit").LimitFunction;
export declare const globalRedisLimit: import("p-limit").LimitFunction;
/**
 * Creates a configurable concurrency limiter for a specific operation.
 */
export declare function createLimiter(concurrency: number): import("p-limit").LimitFunction;
//# sourceMappingURL=limiters.d.ts.map