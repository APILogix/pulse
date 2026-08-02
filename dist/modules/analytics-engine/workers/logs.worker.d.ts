/**
 * analytics.logs — log volume by level, plus logger ranking.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.5
 * Metrics: docs/analytics/10-analytics-catalog.md §5
 *
 * Reads  : events_logs
 * Writes : log_metrics_1m, logger_metrics_1h
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createLogsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=logs.worker.d.ts.map