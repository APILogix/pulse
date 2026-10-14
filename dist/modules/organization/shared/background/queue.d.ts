/**
 * Organization cleanup PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const ORG_CLEANUP_JOBS: {
    readonly hourly: "org_cleanup_hourly";
    readonly daily: "org_cleanup_daily";
};
export interface OrgCleanupSchedule {
    hourlyIntervalMs?: number;
    dailyIntervalMs?: number;
}
export declare function registerOrganizationCleanupWorkers(logger: FastifyBaseLogger, schedule?: OrgCleanupSchedule): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map