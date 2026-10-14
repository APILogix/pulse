/**
 * Analytics engine queue registration (Supabase PGMQ).
 *
 * Spec: docs/analytics/06-worker-architecture.md §1 and §4
 *
 * PGMQ is used purely as job transport on the control-plane database; all
 * analytics DATA lives in the Log DB. Job payloads are tiny and idempotent, so a
 * duplicated delivery recomputes the same bucket to the same value.
 */
import { pgmq } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { env } from '../../config/env.js';
import { ALERT_JOBS } from '../alerting/queue-names.js';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { buildAnalyticsWorkers, resolveAnalyticsConfig } from './registry.js';
import { runCompaction } from './workers/compaction.worker.js';
import { ensurePartitions, runRetention } from './workers/maintenance.worker.js';
import { TIER_INTERVAL_MS } from './types.js';
export const ANALYTICS_PLATFORM_JOBS = {
    compact5m: 'analytics_compaction_5m',
    compact1h: 'analytics_compaction_1h',
    compact1d: 'analytics_compaction_1d',
    retention: 'analytics_retention',
    partitions: 'analytics_partitions',
};
export function analyticsQueueName(raw) {
    return raw.replace(/\./g, '_');
}
/**
 * Registers every analytics worker plus the platform jobs using PGMQ.
 */
export async function registerAnalyticsEngineWorkers(pool, logger) {
    const log = logger.child({ component: 'analytics-engine-queue' });
    const config = resolveAnalyticsConfig();
    const { workers, watermarks } = buildAnalyticsWorkers(pool);
    await pgmq.createQueues([
        ...workers.map((worker) => analyticsQueueName(worker.queue)),
        ...Object.values(ANALYTICS_PLATFORM_JOBS),
    ], { concurrency: 4 });
    const registeredWorkers = [];
    // ── Domain workers ───────────────────────────────────────────────────────
    for (const worker of workers) {
        const qName = analyticsQueueName(worker.queue);
        const domainWorker = new PgmqWorker(pgmq, async (msg) => {
            const jobData = msg.message;
            const startedAt = Date.now();
            try {
                const result = await worker.run({ pool, logger: log, now: new Date(), config }, jobData);
                await watermarks.recordRun({
                    workerId: worker.id,
                    organizationId: jobData.orgId,
                    windowSize: worker.windowSize,
                    windowStart: new Date(jobData.windowStart),
                    windowEnd: new Date(jobData.windowEnd),
                    rowsRead: result.rowsRead,
                    rowsWritten: result.rowsWritten,
                    durationMs: Date.now() - startedAt,
                    outcome: result.outcome,
                    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
                });
                if (result.rowsWritten > 0) {
                    await enqueueAlertEvaluationForAnalyticsWorker(worker.id, jobData.orgId, log);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const failures = await watermarks.recordFailure(worker.id, jobData.orgId, worker.windowSize, message);
                await watermarks.recordRun({
                    workerId: worker.id,
                    organizationId: jobData.orgId,
                    windowSize: worker.windowSize,
                    windowStart: new Date(jobData.windowStart),
                    windowEnd: new Date(jobData.windowEnd),
                    rowsRead: 0,
                    rowsWritten: 0,
                    durationMs: Date.now() - startedAt,
                    outcome: 'failed',
                    errorMessage: message,
                });
                log.error({ err: error, worker: worker.id, orgId: jobData.orgId, consecutiveFailures: failures }, 'Analytics worker run failed; watermark not advanced');
                throw error;
            }
        }, {
            queue: qName,
            concurrency: Math.min(worker.concurrency, env.ANALYTICS_WORKER_CONCURRENCY),
            batchSize: 1,
            visibilityTimeoutSeconds: 120,
        });
        registeredWorkers.push(domainWorker);
    }
    // ── Platform workers ─────────────────────────────────────────────────────
    registeredWorkers.push(new PgmqWorker(pgmq, async () => {
        await runCompaction(pool, log, '5m');
    }, { queue: ANALYTICS_PLATFORM_JOBS.compact5m, batchSize: 1, concurrency: 1 }));
    registeredWorkers.push(new PgmqWorker(pgmq, async () => {
        await runCompaction(pool, log, '1h');
    }, { queue: ANALYTICS_PLATFORM_JOBS.compact1h, batchSize: 1, concurrency: 1 }));
    registeredWorkers.push(new PgmqWorker(pgmq, async () => {
        await runCompaction(pool, log, '1d');
    }, { queue: ANALYTICS_PLATFORM_JOBS.compact1d, batchSize: 1, concurrency: 1 }));
    registeredWorkers.push(new PgmqWorker(pgmq, async () => {
        if (!config.retentionEnabled) {
            log.info('Analytics retention disabled by ANALYTICS_RETENTION_ENABLED=false');
            return;
        }
        await runRetention(pool, log);
    }, { queue: ANALYTICS_PLATFORM_JOBS.retention, batchSize: 1, concurrency: 1 }));
    registeredWorkers.push(new PgmqWorker(pgmq, async () => {
        await ensurePartitions(pool, log, 7);
    }, { queue: ANALYTICS_PLATFORM_JOBS.partitions, batchSize: 1, concurrency: 1 }));
    await Promise.all(registeredWorkers.map((w) => w.start()));
    // ── Dispatcher ───────────────────────────────────────────────────────────
    const activeOrganizations = async () => {
        const [tracked, recent] = await Promise.all([
            watermarks.trackedOrganizations(),
            pool
                .query(`SELECT DISTINCT organization_id
             FROM events_requests
            WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
            LIMIT 1000`)
                .then((result) => result.rows.map((row) => row.organization_id))
                .catch((error) => {
                log.warn({ err: error }, 'Analytics dispatcher could not probe recent organizations');
                return [];
            }),
        ]);
        return [...new Set([...tracked, ...recent])];
    };
    const dispatchTier = async (tier) => {
        try {
            const orgs = await activeOrganizations();
            if (orgs.length === 0)
                return;
            const now = new Date();
            const windowStart = new Date(now.getTime() - TIER_INTERVAL_MS[tier]);
            const tierWorkers = workers.filter((worker) => worker.tier === tier);
            await Promise.allSettled(tierWorkers.flatMap((worker) => orgs.map((orgId) => {
                const q = analyticsQueueName(worker.queue);
                return pgmq.send(q, {
                    orgId,
                    windowStart: windowStart.toISOString(),
                    windowEnd: now.toISOString(),
                });
            })));
            log.debug({ tier, orgs: orgs.length, workers: tierWorkers.length }, 'Analytics jobs dispatched');
        }
        catch (error) {
            log.warn({ err: error, tier }, 'Analytics dispatch failed');
        }
    };
    const timers = [
        setInterval(() => void pgmq.send(ANALYTICS_PLATFORM_JOBS.compact5m, {}).catch(() => { }), 60_000),
        setInterval(() => void pgmq.send(ANALYTICS_PLATFORM_JOBS.compact1h, {}).catch(() => { }), 300_000),
        setInterval(() => void pgmq.send(ANALYTICS_PLATFORM_JOBS.compact1d, {}).catch(() => { }), 900_000),
        setInterval(() => void pgmq.send(ANALYTICS_PLATFORM_JOBS.retention, {}).catch(() => { }), 3600_000),
        setInterval(() => void pgmq.send(ANALYTICS_PLATFORM_JOBS.partitions, {}).catch(() => { }), 86400_000),
    ];
    for (const tier of ['live', 'standard', 'slow']) {
        const timer = setInterval(() => void dispatchTier(tier), TIER_INTERVAL_MS[tier]);
        timer.unref();
        timers.push(timer);
        void dispatchTier(tier);
    }
    for (const t of timers)
        t.unref();
    log.info({ workers: workers.map((worker) => worker.id), platformJobs: Object.values(ANALYTICS_PLATFORM_JOBS) }, 'Analytics engine PGMQ workers registered');
    return {
        workers,
        watermarks,
        stop: async () => {
            for (const timer of timers)
                clearInterval(timer);
            await Promise.all(registeredWorkers.map((w) => w.stop()));
        },
    };
}
async function enqueueAlertEvaluationForAnalyticsWorker(workerId, organizationId, log) {
    const queues = alertQueuesForAnalyticsWorker(workerId);
    if (queues.length === 0)
        return;
    await Promise.all(queues.map(async (queue) => {
        try {
            await pgmq.send(queue, { organizationId, sourceWorkerId: workerId });
        }
        catch (err) {
            log.warn({ err, workerId, organizationId, queue }, 'Alert evaluation enqueue from analytics worker failed');
        }
    }));
}
function alertQueuesForAnalyticsWorker(workerId) {
    if (workerId === 'analytics.requests'
        || workerId === 'analytics.errors'
        || workerId === 'analytics.crons') {
        return [ALERT_JOBS.evaluateWindow];
    }
    if (workerId === 'analytics.metrics'
        || workerId === 'analytics.runtime'
        || workerId === 'analytics.logs'
        || workerId === 'analytics.services'
        || workerId === 'analytics.endpoints') {
        return [ALERT_JOBS.evaluateOperational];
    }
    if (workerId === 'analytics.ai')
        return [ALERT_JOBS.evaluateWindow, ALERT_JOBS.evaluateAi];
    if (workerId === 'analytics.releases') {
        return [ALERT_JOBS.evaluateAi];
    }
    return [];
}
//# sourceMappingURL=queue.js.map