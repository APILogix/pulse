/**
 * Analytics engine queue registration (pg-boss).
 *
 * Spec: docs/analytics/06-worker-architecture.md §1 and §4
 *
 * pg-boss is used purely as job transport on the control-plane database; all
 * analytics DATA lives in the Log DB. Job payloads are tiny and idempotent, so a
 * duplicated delivery recomputes the same bucket to the same value.
 *
 * This module is imported ONLY by src/shared/workers/analytics-worker-main.ts.
 * It is never imported by the ingestion worker or the API process.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { type AnalyticsWorkerSpec } from './types.js';
export declare const ANALYTICS_PLATFORM_JOBS: {
    readonly compact5m: "analytics.compaction.5m";
    readonly compact1h: "analytics.compaction.1h";
    readonly compact1d: "analytics.compaction.1d";
    readonly retention: "analytics.retention";
    readonly partitions: "analytics.partitions";
};
export interface AnalyticsEngineRuntime {
    workers: AnalyticsWorkerSpec[];
    watermarks: AnalyticsWatermarkRepository;
    stop: () => Promise<void>;
}
/**
 * Registers every analytics worker plus the platform jobs.
 *
 * Fan-out: a self-managed interval per tier enqueues one job per (worker, org)
 * with a singleton key, so duplicate dispatches collapse instead of piling up.
 * pg-boss `schedule` is per-queue and cannot express per-org fan-out, which is
 * why the dispatcher is an interval rather than a cron entry.
 */
export declare function registerAnalyticsEngineWorkers(pool: Pool, logger: Logger): Promise<AnalyticsEngineRuntime>;
//# sourceMappingURL=queue.d.ts.map