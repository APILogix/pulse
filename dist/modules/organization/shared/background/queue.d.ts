/**
 * Organization cleanup pg-boss queue wiring (Postgres-backed cron — no Redis).
 *
 * Why pg-boss schedules instead of setInterval:
 *   - The API runs under PM2 cluster mode (one process per core); a setInterval
 *     there would fire N times. pg-boss schedules are stored in Postgres and a
 *     scheduled job is delivered to exactly ONE worker, so cleanup runs once
 *     regardless of how many worker/cron processes are live.
 *   - Mirrors how the alerting and event-analytics modules schedule their
 *     maintenance jobs (see modules/alerting/queue.ts).
 *
 * Registration runs in the WORKER process (src/workers/main.ts) by default, and
 * can alternatively run in a dedicated cron process (src/workers/cron.ts). Both
 * are safe to run simultaneously — pg-boss upserts the schedule by name and only
 * one consumer gets each fired job.
 *
 * Cron cadences (server timezone):
 *   - org.cleanup.hourly : top of every hour  — expire stale invitations,
 *                          revoke expired API keys / SCIM tokens.
 *   - org.cleanup.daily  : 03:30 daily         — purge terminal invitations,
 *                          drained email outbox, and audit logs past retention.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const ORG_CLEANUP_JOBS: {
    readonly hourly: "org.cleanup.hourly";
    readonly daily: "org.cleanup.daily";
};
export interface OrgCleanupSchedule {
    /** Cron for the hourly state-move pass. Default: top of every hour. */
    hourlyCron?: string;
    /** Cron for the daily purge pass. Default: 03:30 daily. */
    dailyCron?: string;
}
/**
 * Register the organization cleanup workers + cron schedules. Idempotent per
 * process. Returns a stop() that cancels the schedules (handlers drain via
 * pg-boss shutdown).
 */
export declare function registerOrganizationCleanupWorkers(logger: FastifyBaseLogger, schedule?: OrgCleanupSchedule): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map