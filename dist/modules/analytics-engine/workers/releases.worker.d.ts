/**
 * analytics.releases — per-release traffic, reliability and latency.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.16
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests
 * Writes : release_metrics_1h
 *
 * The verdict/comparison row (`release_comparison`) is computed from these
 * rollups by a second statement, so the release dashboard's hardcoded
 * COMPARISON table can be deleted (docs/analytics/02-dummy-data-audit.md §1).
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createReleasesWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=releases.worker.d.ts.map