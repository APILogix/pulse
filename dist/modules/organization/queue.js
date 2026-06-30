import { pgboss } from '../../lib/pgboss.js';
import { OrganizationRepository } from './repository.js';
import { runDailyOrgCleanup, runHourlyOrgCleanup } from './cleanup.js';
export const ORG_CLEANUP_JOBS = {
    hourly: 'org.cleanup.hourly',
    daily: 'org.cleanup.daily',
};
const DEFAULT_SCHEDULE = {
    hourlyCron: '0 * * * *',
    dailyCron: '30 3 * * *',
};
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
/**
 * Register the organization cleanup workers + cron schedules. Idempotent per
 * process. Returns a stop() that cancels the schedules (handlers drain via
 * pg-boss shutdown).
 */
export async function registerOrganizationCleanupWorkers(logger, schedule = {}) {
    const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
    const log = logger.child({ component: 'org-cleanup-workers' });
    const repo = new OrganizationRepository();
    await safeCreateQueue(ORG_CLEANUP_JOBS.hourly);
    await safeCreateQueue(ORG_CLEANUP_JOBS.daily);
    // Handlers receive an array of jobs in pg-boss v12; we ignore the payload and
    // just run the sweep. retryLimit keeps a transient DB blip from skipping a run.
    await pgboss.work(ORG_CLEANUP_JOBS.hourly, {}, (async () => {
        await runHourlyOrgCleanup(repo, log);
    }));
    await pgboss.work(ORG_CLEANUP_JOBS.daily, {}, (async () => {
        await runDailyOrgCleanup(repo, log);
    }));
    await pgboss.schedule(ORG_CLEANUP_JOBS.hourly, cfg.hourlyCron, {}, {});
    await pgboss.schedule(ORG_CLEANUP_JOBS.daily, cfg.dailyCron, {}, {});
    log.info({ ...cfg }, 'Organization cleanup cron registered');
    return {
        stop: async () => {
            await pgboss.unschedule(ORG_CLEANUP_JOBS.hourly).catch(() => undefined);
            await pgboss.unschedule(ORG_CLEANUP_JOBS.daily).catch(() => undefined);
        },
    };
}
//# sourceMappingURL=queue.js.map