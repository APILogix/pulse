/**
 * analytics.errors — error volume, group rollups and group state.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.4
 * Metrics: docs/analytics/10-analytics-catalog.md §4
 *
 * Reads  : events_errors
 * Writes : error_metrics_1m, error_group_metrics_1m, error_dimension_metrics_1h,
 *          analytics_error_groups (state table, upsert-only)
 *
 * analytics_error_groups is user-mutable (resolve / ignore / assign), so this
 * worker only ever touches the observation columns and leaves status, priority,
 * assignee, resolved_at and resolved_by alone.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createErrorsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=errors.worker.d.ts.map