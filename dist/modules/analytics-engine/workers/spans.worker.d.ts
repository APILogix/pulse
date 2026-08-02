/**
 * analytics.spans — operation latency, self time, DB statements, external deps.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.8
 * Metrics: docs/analytics/10-analytics-catalog.md §8
 *
 * Reads  : events_spans
 * Writes : span_metrics_1m, db_metrics_1h, dependency_metrics_1h
 *
 * Statement normalisation happens here, in SQL, exactly once — replacing the
 * per-render regex work the tracing dashboard does in the browser today
 * (docs/analytics/02-dummy-data-audit.md §2).
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createSpansWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=spans.worker.d.ts.map