/**
 * analytics.metrics — custom metric series summary.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.6
 * Metrics: docs/analytics/10-analytics-catalog.md §6
 *
 * Reads  : events_metrics (excluding the reserved runtime.* namespace, which
 *          belongs to analytics.runtime)
 * Writes : metric_series_1m
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
/** Reserved prefix owned by analytics.runtime — excluded here to avoid double ownership. */
export declare const RUNTIME_METRIC_PREFIX = "runtime.";
export declare function createMetricsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=metrics.worker.d.ts.map