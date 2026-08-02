/**
 * analytics.requests — tenant/time request summary.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.1
 * Metrics: docs/analytics/10-analytics-catalog.md §1
 *
 * Reads  : events_requests (read-only)
 * Writes : request_metrics_1m
 *
 * Coarser tiers (5m/1h/1d) are produced by analytics.compaction, never here.
 */
import { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createRequestsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=requests.worker.d.ts.map