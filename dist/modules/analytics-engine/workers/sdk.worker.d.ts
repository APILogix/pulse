/**
 * analytics.sdk — SDK name/version adoption across every signal.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.15
 * Metrics: docs/analytics/10-analytics-catalog.md §12
 *
 * Reads  : events_requests (representative signal; every typed table carries
 *          sdk_name/sdk_version, and requests are the highest-coverage source)
 * Writes : sdk_metrics_1h
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createSdkWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=sdk.worker.d.ts.map