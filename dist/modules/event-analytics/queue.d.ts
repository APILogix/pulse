/**
 * Event-analytics pg-boss workers.
 *
 * Jobs (registered in the WORKER process — see workers/main.ts):
 *   - analytics.rollup-hourly      — refresh hourly rollups per org
 *   - analytics.error-grouping     — upsert analytics_error_groups per org
 *   - analytics.partition-maintain — create upcoming daily partitions
 *
 * Scheduled "fan-out" jobs enumerate orgs with recent data and enqueue the
 * per-org work. pg-boss v12 option names are used (localConcurrency/batchSize/
 * expireInSeconds); the WorkHandler receives an ARRAY of jobs.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const ANALYTICS_JOBS: {
    readonly rollupHourly: "analytics.rollup-hourly";
    readonly errorGrouping: "analytics.error-grouping";
    readonly partitionMaintain: "analytics.partition-maintain";
};
export declare function registerAnalyticsWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map