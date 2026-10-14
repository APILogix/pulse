/**
 * Event-analytics PGMQ workers.
 *
 * Jobs:
 *   - analytics_rollup_hourly      — refresh hourly rollups per org
 *   - analytics_error_grouping     — upsert analytics_error_groups per org
 *   - analytics_partition_maintain — create upcoming daily partitions
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const ANALYTICS_JOBS: {
    readonly rollupHourly: "analytics_rollup_hourly";
    readonly errorGrouping: "analytics_error_grouping";
    readonly partitionMaintain: "analytics_partition_maintain";
};
export declare function registerAnalyticsWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map