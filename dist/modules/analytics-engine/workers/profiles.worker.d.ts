/**
 * analytics.profiles and analytics.replays.
 *
 * Spec: docs/analytics/06-worker-architecture.md §3.11 and §3.12
 * Metrics: docs/analytics/10-analytics-catalog.md §11
 *
 * profiles → profile_metrics_1h, profile_function_metrics_1h
 * replays  → replay_metrics_1h
 *
 * Hot-function extraction unnests `profile_data->'nodes'` in SQL so the browser
 * no longer sorts profile nodes to find the hottest frame.
 */
import type { AnalyticsWatermarkRepository } from '../watermark.repository.js';
import type { AnalyticsWorkerSpec } from '../types.js';
export declare function createProfilesWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
export declare function createReplaysWorker(watermarks: AnalyticsWatermarkRepository): AnalyticsWorkerSpec;
//# sourceMappingURL=profiles.worker.d.ts.map