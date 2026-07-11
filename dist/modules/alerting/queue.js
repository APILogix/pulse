import { pgboss } from '../../lib/pgboss.js';
import { AlertingRepository } from './repository.js';
import { AlertBatchProcessor } from './batch-processor.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { NotificationDispatcher } from '../connectors/delivery/delivery.service.js';
export const ALERT_JOBS = {
    formBatches: 'alert.form-batches',
    processBatch: 'alert.process-batch',
    autoResolve: 'alert.auto-resolve',
    cleanup: 'alert.cleanup',
};
const BATCH_SIZE = 100;
const DEFAULTS = {
    teamSize: 5,
    teamConcurrency: 5,
    formIntervalSeconds: 30,
    autoResolveIntervalSeconds: 60,
    maxBatchesPerFormRun: 20,
};
function firstJob(arg) {
    if (Array.isArray(arg))
        return arg[0] ?? null;
    return arg ?? null;
}
function allJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
/**
 * Register all alerting pg-boss workers + schedules. Idempotent per process.
 * Returns a stop() that cancels schedules.
 */
export async function registerAlertingWorkers(logger, config = {}) {
    const cfg = { ...DEFAULTS, ...config };
    const log = logger.child({ component: 'alerting-workers' });
    const alertRepo = new AlertingRepository();
    const connectorRepo = new ConnectorRepository();
    const dispatcher = new NotificationDispatcher(connectorRepo, logger);
    const processor = new AlertBatchProcessor(alertRepo, connectorRepo, dispatcher, logger);
    // Ensure queues exist (pg-boss v10+ requires explicit creation in some setups).
    await safeCreateQueue(ALERT_JOBS.formBatches);
    await safeCreateQueue(ALERT_JOBS.processBatch);
    await safeCreateQueue(ALERT_JOBS.autoResolve);
    // ── process-batch: the high-throughput worker ──────────────────────────
    // pg-boss v12 concurrency options: `localConcurrency` = number of workers
    // polling/processing independently (the spec's teamSize/teamConcurrency = 5),
    // `batchSize` = jobs fetched per poll. The WorkHandler always receives an
    // ARRAY of jobs in v12.
    await pgboss.work(ALERT_JOBS.processBatch, { localConcurrency: cfg.teamConcurrency, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        // Each delivered job is independent; process concurrently (no sequential await loop).
        await Promise.all(jobs.map((job) => processor.processBatch(job.data)));
    }));
    // ── form-batches: claim pending → enqueue process-batch jobs ────────────
    await pgboss.work(ALERT_JOBS.formBatches, {}, (async (arg) => {
        const job = firstJob(arg);
        await formBatches(alertRepo, log, cfg.maxBatchesPerFormRun, job?.data?.organizationId);
    }));
    // ── auto-resolve: resolve stale firing alerts ──────────────────────────
    await pgboss.work(ALERT_JOBS.autoResolve, {}, (async () => {
        const stale = await alertRepo.claimAutoResolvable(200);
        // Resolve concurrently — no sequential async loop.
        await Promise.allSettled(stale.map(async (event) => {
            await alertRepo.resolveEvent(event.organization_id, event.id, null, 'auto_resolved', true);
            await alertRepo.insertHistory({
                eventId: event.id, organizationId: event.organization_id,
                action: 'auto_resolved', actorId: null, actorType: 'worker',
            });
        }));
        if (stale.length > 0)
            log.info({ resolved: stale.length }, 'Auto-resolved stale alerts');
    }));
    // ── Schedules (cron) ────────────────────────────────────────────────────
    // pg-boss cron is minute-granularity; sub-minute cadence is approximated by
    // the form worker re-claiming whatever is pending each run.
    await pgboss.schedule(ALERT_JOBS.formBatches, '* * * * *', {}, {});
    await pgboss.schedule(ALERT_JOBS.autoResolve, '* * * * *', {}, {});
    log.info({ ...cfg }, 'Alerting workers registered');
    return {
        stop: async () => {
            await pgboss.unschedule(ALERT_JOBS.formBatches).catch(() => undefined);
            await pgboss.unschedule(ALERT_JOBS.autoResolve).catch(() => undefined);
        },
    };
}
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
/**
 * Claim pending events (in batches of 100) for orgs that have any, and enqueue
 * a process-batch job per batch. Bounded by `maxBatches` per run to avoid
 * starving other queues.
 */
async function formBatches(alertRepo, log, maxBatches, onlyOrgId) {
    const orgIds = onlyOrgId ? [onlyOrgId] : await alertRepo.findOrgsWithPendingEvents(maxBatches);
    if (orgIds.length === 0)
        return 0;
    // Form one batch per org concurrently, then enqueue. Repeat per org while it
    // still has a full batch worth, up to the global cap.
    let formed = 0;
    await Promise.all(orgIds.map(async (orgId) => {
        const workerId = `former-${process.pid}`;
        const batch = await alertRepo.createBatchFromPending(orgId, BATCH_SIZE, workerId);
        if (batch) {
            await pgboss.send(ALERT_JOBS.processBatch, { batchId: batch.id, organizationId: orgId }, 
            // Spec: retryLimit 3, retryDelay 60s, retryBackoff true, expire in 2h.
            // v12 uses expireInSeconds (not expireInHours).
            { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 });
            formed += 1;
        }
    }));
    if (formed > 0)
        log.info({ formed }, 'Formed and enqueued alert batches');
    return formed;
}
//# sourceMappingURL=queue.js.map