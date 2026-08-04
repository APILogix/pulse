/**
 * analytics.runtime — Node/V8 diagnostics (heap, RSS, handles, event loop, GC).
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.7
 * Metrics: docs/analytics/10-analytics-catalog.md §7
 *
 * Reads  : events_metrics where metric_name LIKE 'runtime.%'
 * Writes : runtime_metrics_1m, gc_metrics_1m
 *
 * This worker is what replaces the three fabricated frontend datasets
 * (dummyRuntimeMetricSamples / dummyEventLoopSamples / dummyGcPauseEvents) —
 * see docs/analytics/02-dummy-data-audit.md §4. The Log DB has no dedicated
 * runtime table, so the SDK reports these as reserved custom metrics.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
/** Reserved metric names. Documented in docs/analytics/10-analytics-catalog.md §7. */
export declare const RUNTIME_METRICS: {
    readonly heapUsed: "runtime.heap.used";
    readonly heapTotal: "runtime.heap.total";
    readonly external: "runtime.memory.external";
    readonly rss: "runtime.memory.rss";
    readonly handles: "runtime.handles.active";
    readonly eventLoopLag: "runtime.eventloop.lag";
    readonly eventLoopUtilization: "runtime.eventloop.utilization";
    readonly gcPause: "runtime.gc.pause";
};
export declare function createRuntimeWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=runtime.worker.d.ts.map