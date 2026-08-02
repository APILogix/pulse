/**
 * analytics.endpoints — per route/method breakdown.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.2
 * Metrics: docs/analytics/10-analytics-catalog.md §2
 *
 * Reads  : events_requests
 * Writes : endpoint_metrics_1m
 *
 * entity_key = md5(method || ' ' || coalesce(route, url)) so the key stays
 * bounded even when URLs are long, with entity_label carrying the display value.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createEndpointsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=endpoints.worker.d.ts.map