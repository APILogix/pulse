/**
 * analytics.traces — trace counts, duration percentiles, service edges.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.9
 * Metrics: docs/analytics/10-analytics-catalog.md §9
 *
 * Reads  : events_traces, events_spans (for the service graph)
 * Writes : trace_metrics_1m, trace_edge_metrics_1h
 *
 * The edge query self-joins spans on parent_span_id inside a trace, which is the
 * server-side replacement for the client-side grouping the tracing dashboard
 * performs today.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createTracesWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=traces.worker.d.ts.map