/**
 * analytics.crons — cron check-in outcomes and monitor state.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.10
 * Metrics: docs/analytics/10-analytics-catalog.md §10
 *
 * Reads  : events_cron_checkins
 * Writes : cron_metrics_1m, cron_monitor_state
 *
 * Missed-run detection infers the expected interval from the median gap between
 * the last 20 check-ins, so it works without the user declaring a schedule.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createCronsWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=crons.worker.d.ts.map