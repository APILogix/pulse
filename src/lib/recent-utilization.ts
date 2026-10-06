import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';

/** A moving sample, rather than utilization accumulated since API bootstrap. */
export function recentUtilizationSampler(read = () => performance.eventLoopUtilization()): () => number {
  let previous = read();
  return () => {
    const current = read();
    const active = current.active - previous.active;
    const idle = current.idle - previous.idle;
    previous = current;
    return active + idle > 0 ? active / (active + idle) : 0;
  };
}

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
export function recentEventLoopDelaySampler(
  resolution = 10,
  histogramFactory: () => IntervalHistogram = () => monitorEventLoopDelay({ resolution }),
): () => number {
  let histogram: IntervalHistogram | null = null;
  try {
    histogram = histogramFactory();
    histogram.enable();
  } catch {
    histogram = null;
  }

  return () => {
    if (!histogram) return 0;
    // In Node.js, histogram.mean is NaN when count === 0
    const delay = histogram.count > 0 ? Math.max(0, histogram.mean / 1e6 - resolution) : 0;
    histogram.reset();
    return Number.isFinite(delay) ? delay : 0;
  };
}
