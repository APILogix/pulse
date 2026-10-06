/**
 * Analytics engine queue registration (Supabase PGMQ).
 *
 * Spec: docs/analytics/06-worker-architecture.md §1 and §4
 *
 * PGMQ is used purely as job transport on the control-plane database; all
 * analytics DATA lives in the Log DB. Job payloads are tiny and idempotent, so a
 * duplicated delivery recomputes the same bucket to the same value.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { type AnalyticsWorkerSpec } from './types.js';
export declare const ANALYTICS_PLATFORM_JOBS: {
    readonly compact5m: "analytics_compaction_5m";
    readonly compact1h: "analytics_compaction_1h";
    readonly compact1d: "analytics_compaction_1d";
    readonly retention: "analytics_retention";
    readonly partitions: "analytics_partitions";
};
export interface AnalyticsEngineRuntime {
    workers: AnalyticsWorkerSpec[];
    watermarks: AnalyticsWatermarkRepository;
    stop: () => Promise<void>;
}
export declare function analyticsQueueName(raw: string): string;
/**
 * Registers every analytics worker plus the platform jobs using PGMQ.
 */
export declare function registerAnalyticsEngineWorkers(pool: Pool, logger: Logger): Promise<AnalyticsEngineRuntime>;
//# sourceMappingURL=queue.d.ts.map