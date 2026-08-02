/**
 * analytics.services — per service health.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.3
 * Metrics: docs/analytics/10-analytics-catalog.md §3
 *
 * Reads  : events_requests
 * Writes : service_metrics_1m
 *
 * availability_pct and health_score are stored (not derived at read time)
 * because the service fleet tiles and the SLO worker both consume them, and one
 * server-side formula is the whole point of the catalog.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createServicesWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=services.worker.d.ts.map