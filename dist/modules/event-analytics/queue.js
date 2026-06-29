import { pgboss } from '../../lib/pgboss.js';
import { pool } from '../../config/database.js';
import { EventAnalyticsRepository } from './repository.js';
export const ANALYTICS_JOBS = {
    rollupHourly: 'analytics.rollup-hourly',
    errorGrouping: 'analytics.error-grouping',
    partitionMaintain: 'analytics.partition-maintain',
};
function allJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
export async function registerAnalyticsWorkers(logger) {
    const log = logger.child({ component: 'event-analytics-workers' });
    const repo = new EventAnalyticsRepository(pool);
    const boss = pgboss;
    for (const name of Object.values(ANALYTICS_JOBS)) {
        if (typeof boss.createQueue === 'function')
            await boss.createQueue(name).catch(() => undefined);
    }
    // Per-org hourly rollup (refresh the trailing 2 hours to catch late events).
    await pgboss.work(ANALYTICS_JOBS.rollupHourly, { localConcurrency: 2, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.allSettled(jobs.map(async (job) => {
            const end = new Date();
            const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
            await repo.refreshHourlyRollup(job.data.orgId, start, end);
        }));
    }));
    // Per-org error grouping.
    await pgboss.work(ANALYTICS_JOBS.errorGrouping, { localConcurrency: 2, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.allSettled(jobs.map((job) => repo.refreshErrorGroups(job.data.orgId, 24)));
    }));
    // Partition maintenance — keep a week of daily partitions ahead.
    await pgboss.work(ANALYTICS_JOBS.partitionMaintain, {}, (async () => {
        await pool.query('SELECT create_event_partitions(7)');
        log.info('Daily partitions ensured');
    }));
    // ── Fan-out via cron-ish scheduling ──────────────────────────────────────
    // Every 5 minutes: enqueue hourly rollup + error grouping for orgs with
    // recent errors. Partition maintenance runs daily.
    await pgboss.schedule(ANALYTICS_JOBS.partitionMaintain, '0 0 * * *', {}, {});
    // pg-boss schedule is per-queue; we use a lightweight self-managed interval
    // to fan out per-org jobs (kept in the worker process, unref'd).
    const fanOut = async () => {
        try {
            const orgs = await repo.listOrgsWithRecentErrors(2);
            await Promise.allSettled(orgs.flatMap((orgId) => [
                pgboss.send(ANALYTICS_JOBS.rollupHourly, { orgId }, { expireInSeconds: 600 }),
                pgboss.send(ANALYTICS_JOBS.errorGrouping, { orgId }, { expireInSeconds: 600 }),
            ]));
            if (orgs.length > 0)
                log.debug({ orgs: orgs.length }, 'Enqueued analytics rollups');
        }
        catch (err) {
            log.warn({ err }, 'Analytics fan-out failed');
        }
    };
    const timer = setInterval(() => void fanOut(), 5 * 60 * 1000);
    timer.unref();
    void fanOut(); // prime immediately
    log.info('Event-analytics workers registered');
    return {
        stop: async () => {
            clearInterval(timer);
            await pgboss.unschedule(ANALYTICS_JOBS.partitionMaintain).catch(() => undefined);
        },
    };
}
//# sourceMappingURL=queue.js.map