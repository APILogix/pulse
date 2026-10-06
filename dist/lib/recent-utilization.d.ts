import type { IntervalHistogram } from 'node:perf_hooks';
/** A moving sample, rather than utilization accumulated since API bootstrap. */
export declare function recentUtilizationSampler(read?: () => import("node:perf_hooks").EventLoopUtilization): () => number;
/**
 * A robust rolling sample for event loop delay that protects against the
 * `@fastify/under-pressure` NaN/Infinity false-positive shedding bug.
 *
 * In @fastify/under-pressure, when histogram.count === 0 (which happens during
 * low traffic, idle periods, or right after reset), histogram.mean is NaN.
 * Under-pressure incorrectly sets `eventLoopDelay = Infinity`, immediately
 * shedding all requests with 503 and logging `{ type: "eventLoopDelay", value: null }`.
 *
 * This sampler safely yields 0ms on idle/zero-sample intervals and only reports
 * real, non-zero delays in milliseconds when measurements exist.
 */
export declare function recentEventLoopDelaySampler(resolution?: number, histogramFactory?: () => IntervalHistogram): () => number;
//# sourceMappingURL=recent-utilization.d.ts.map