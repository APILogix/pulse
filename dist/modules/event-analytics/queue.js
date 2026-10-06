import { pgmq } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { logDB } from '../../config/log-database.js';
import { EventAnalyticsRepository } from './repository.js';
export const ANALYTICS_JOBS = {
    rollupHourly: 'analytics_rollup_hourly',
    errorGrouping: 'analytics_error_grouping',
    partitionMaintain: 'analytics_partition_maintain',
};
export async function registerAnalyticsWorkers(logger) {
    const log = logger.child({ component: 'event-analytics-workers' });
    const logDbPool = logDB.getPrimaryPool();
    const repo = new EventAnalyticsRepository(logDbPool);
    await pgmq.createQueues(Object.values(ANALYTICS_JOBS), { concurrency: 4 });
    // Per-org hourly rollup
    const rollupWorker = new PgmqWorker(pgmq, async (msg) => {
        const end = new Date();
        const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
        await repo.refreshHourlyRollup(msg.message.orgId, start, end);
    }, { queue: ANALYTICS_JOBS.rollupHourly, batchSize: 1, concurrency: 2 });
    // Per-org error grouping
    const errorGroupingWorker = new PgmqWorker(pgmq, async (msg) => {
        await repo.refreshErrorGroups(msg.message.orgId, 24);
    }, { queue: ANALYTICS_JOBS.errorGrouping, batchSize: 1, concurrency: 2 });
    // Partition maintenance
    const partWorker = new PgmqWorker(pgmq, async () => {
        await logDbPool.query('SELECT create_event_partitions(7)');
        log.info('Daily partitions ensured');
    }, { queue: ANALYTICS_JOBS.partitionMaintain, batchSize: 1, concurrency: 1 });
    const workers = [rollupWorker, errorGroupingWorker, partWorker];
    await Promise.all(workers.map((w) => w.start()));
    // Fan-out interval
    const fanOut = async () => {
        try {
            const orgs = await repo.listOrgsWithRecentErrors(2);
            await Promise.allSettled(orgs.flatMap((orgId) => [
                pgmq.send(ANALYTICS_JOBS.rollupHourly, { orgId }),
                pgmq.send(ANALYTICS_JOBS.errorGrouping, { orgId }),
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
    void fanOut();
    log.info('Event-analytics PGMQ workers registered');
    return {
        stop: async () => {
            clearInterval(timer);
            await Promise.all(workers.map((w) => w.stop()));
        },
    };
}
//# sourceMappingURL=queue.js.map