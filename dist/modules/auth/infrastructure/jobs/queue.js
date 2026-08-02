import { pgboss } from '../../../../lib/pgboss.js';
import { runDailyAuthAutomation } from './cleanup.js';
export const AUTH_AUTOMATION_JOBS = {
    daily: 'auth.automation.daily',
};
const DEFAULT_SCHEDULE = {
    dailyCron: '15 2 * * *',
};
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
export async function registerAuthAutomationWorkers(logger, schedule = {}) {
    const cfg = { ...DEFAULT_SCHEDULE, ...schedule };
    const log = logger.child({ component: 'auth-automation-workers' });
    await safeCreateQueue(AUTH_AUTOMATION_JOBS.daily);
    await pgboss.work(AUTH_AUTOMATION_JOBS.daily, {}, (async () => {
        await runDailyAuthAutomation(log);
    }));
    await pgboss.schedule(AUTH_AUTOMATION_JOBS.daily, cfg.dailyCron, {}, {});
    log.info({ ...cfg }, 'Auth automation cron registered');
    return {
        stop: async () => {
            await pgboss.unschedule(AUTH_AUTOMATION_JOBS.daily).catch(() => undefined);
        },
    };
}
//# sourceMappingURL=queue.js.map