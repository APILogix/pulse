import { pgboss } from '../../lib/pgboss.js';
import { env } from '../../config/env.js';
import { pool } from '../../config/database.js';
import { AlertingRepository } from './repository.js';
import { AlertEscalationSweep } from './escalation.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { AlertRuntimeEngines } from './runtime/engines.js';
import { NotificationRoutingService } from './runtime/notification-routing.service.js';
import { AlertChannelRepository } from '../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from './config/alert-config.repository.js';
import { AlertNotificationRouter } from './runtime/notification-router.js';
import { TelemetryOutboxRelay } from './runtime/telemetry-outbox-relay.js';
import { SnapshotEscalationWorker } from './escalation/escalation.worker.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';
import { EmailOnlyRestrictedRouting, ProjectOwnerRepository } from './runtime/email-only-restricted-routing.js';
export const ALERT_JOBS = {
    cleanup: 'alert.cleanup',
    escalate: 'alert.escalate',
    escalationSweep: 'alert.escalation-sweep',
    evaluateFast: 'alert.evaluate.fast',
    evaluateWindow: 'alert.evaluate.window',
    evaluateOperational: 'alert.evaluate.operational',
    evaluateAi: 'alert.evaluate.ai',
    notificationRouter: 'alert.notification-router',
    telemetryOutboxRelay: 'alert.telemetry-outbox-relay',
    errorGroupRegressed: 'alert.error-group-regressed',
};
const DEFAULTS = {
    group: 'all',
    strictQueueCreation: false,
    sweepClaimLimit: 200,
    retentionResolvedEventsDays: 30,
    retentionBatchesDays: 14,
    retentionDeliveryAttemptsDays: 30,
    retentionDeadLettersDays: 30,
};
export const ALERT_DELIVERY_WORKER_JOBS = [
    ALERT_JOBS.escalate,
    ALERT_JOBS.escalationSweep,
    ALERT_JOBS.evaluateFast,
    ALERT_JOBS.evaluateWindow,
    ALERT_JOBS.evaluateOperational,
    ALERT_JOBS.evaluateAi,
    ALERT_JOBS.notificationRouter,
    ALERT_JOBS.telemetryOutboxRelay,
    ALERT_JOBS.errorGroupRegressed,
];
function allJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
/**
 * Register all Alerting V2 pg-boss workers + timers. Idempotent per process.
 */
export async function registerAlertingWorkers(logger, config = {}, _projectSubscriptionResolver, telemetryPool) {
    const cfg = { ...DEFAULTS, ...config };
    const alertDeliveryOnly = cfg.group === 'alert-delivery';
    const log = logger.child({ component: 'alerting-workers', group: cfg.group });
    const alertRepo = new AlertingRepository();
    const connectorRepo = new ConnectorRepository();
    const enqueueConnectorJob = async (queue, data, options) => pgboss.send(queue, data, options);
    const entitlement = new NotificationEntitlementService();
    const runtimePool = telemetryPool ?? pool;
    const projectOwners = new ProjectOwnerRepository(pool);
    const routing = new NotificationRoutingService({
        logger,
        channelRepository: new AlertChannelRepository(pool),
        configRepository: new AlertConfigRepository(pool),
        entitlementService: entitlement,
        restrictedRouting: new EmailOnlyRestrictedRouting(projectOwners),
    });
    const escalationSweep = new AlertEscalationSweep(alertRepo, connectorRepo, enqueueConnectorJob, logger);
    // ── Queue creation with enterprise defaults ─────────────────────────────
    const alertJobs = alertDeliveryOnly
        ? ALERT_DELIVERY_WORKER_JOBS
        : Object.values(ALERT_JOBS);
    for (const job of alertJobs) {
        await safeCreateQueue(job, job === ALERT_JOBS.errorGroupRegressed
            ? { retryLimit: 3, retryDelay: 1, retryBackoff: true, expireInSeconds: 300 }
            : undefined, cfg.strictQueueCreation);
    }
    const runtimeEngines = new AlertRuntimeEngines(logger, runtimePool, pool, routing);
    const notificationRouter = new AlertNotificationRouter(runtimePool, logger, projectOwners);
    const telemetryOutboxRelay = new TelemetryOutboxRelay(runtimePool, logger);
    const snapshotEscalation = new SnapshotEscalationWorker(logger, runtimePool, routing);
    // ── escalation-sweep: advance due escalations + resume expired acks ─────
    await pgboss.work(ALERT_JOBS.escalationSweep, {}, (async () => {
        await escalationSweep.run(cfg.sweepClaimLimit);
    }));
    // ── cleanup: retention purge ────────────────────────────────────────────
    if (!alertDeliveryOnly) {
        await pgboss.work(ALERT_JOBS.cleanup, {}, (async () => {
            const [events, batches, attempts, deadLetters, throttles] = await Promise.all([
                alertRepo.purgeOldTerminalEvents(cfg.retentionResolvedEventsDays),
                alertRepo.purgeOldBatches(cfg.retentionBatchesDays),
                alertRepo.purgeOldDeliveryAttempts(cfg.retentionDeliveryAttemptsDays),
                alertRepo.purgeOldDeadLetters(cfg.retentionDeadLettersDays),
                alertRepo.purgeOldThrottleWindows(),
            ]);
            log.info({ events, batches, attempts, deadLetters, throttles }, 'Alerting retention cleanup finished');
        }));
    }
    // ── Snapshot escalation worker ──────────────────────────────────────────
    await pgboss.work(ALERT_JOBS.escalate, { localConcurrency: 4, batchSize: 1 }, (async (arg) => {
        if (!env.ESCALATION_V2)
            return;
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => snapshotEscalation.run(job.data)));
    }));
    // ── Canonical V2 fast evaluator ─────────────────────────────────────────
    await pgboss.work(ALERT_JOBS.evaluateFast, { localConcurrency: 8, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => runtimeEngines.evaluateFast(job.data)));
    }));
    // ── Canonical V2 window tier evaluator ──────────────────────────────────
    await pgboss.work(ALERT_JOBS.evaluateWindow, { localConcurrency: 4, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'window' })));
    }));
    // ── Canonical V2 operational tier evaluator ─────────────────────────────
    await pgboss.work(ALERT_JOBS.evaluateOperational, { localConcurrency: 3, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'operational' })));
    }));
    // ── Canonical V2 AI tier evaluator ──────────────────────────────────────
    await pgboss.work(ALERT_JOBS.evaluateAi, { localConcurrency: 2, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'ai' })));
    }));
    // ── Canonical V2 notification router ────────────────────────────────────
    await pgboss.work(ALERT_JOBS.notificationRouter, { localConcurrency: 5, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map((job) => job.data.notificationJobId
            ? notificationRouter.dispatchById(job.data.notificationJobId)
            : notificationRouter.run(100)));
    }));
    // ── Canonical V2 telemetry outbox relay ─────────────────────────────────
    await pgboss.work(ALERT_JOBS.telemetryOutboxRelay, { localConcurrency: 2, batchSize: 1 }, (async () => {
        await telemetryOutboxRelay.run(250);
    }));
    // ── Canonical V2 error regression evaluator ─────────────────────────────
    await pgboss.work(ALERT_JOBS.errorGroupRegressed, { localConcurrency: 4, batchSize: 1 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map(async (job) => {
            const payload = job.data;
            await runtimeEngines.evaluateFast({
                organizationId: String(payload.organizationId ?? ''),
                projectId: String(payload.projectId ?? ''),
                environment: typeof payload.environment === 'string' ? payload.environment : null,
                events: [{
                        type: 'error',
                        eventId: String(payload.eventId ?? ''),
                        message: String(payload.eventType ?? 'ErrorGroupRegressed'),
                        severity: String(payload.severity ?? 'error'),
                        fingerprint: String(payload.fingerprint ?? ''),
                    }],
            });
        }));
    }));
    // ── Schedules (cron & timers) ───────────────────────────────────────────
    await pgboss.schedule(ALERT_JOBS.escalationSweep, '* * * * *', {}, { singletonKey: 'alert-escalation-sweep' });
    if (!alertDeliveryOnly) {
        await pgboss.schedule(ALERT_JOBS.cleanup, '17 3 * * *', {}, { singletonKey: 'alert-cleanup' });
    }
    const runtimeTimers = startRuntimeDispatchTimers(runtimePool, log);
    log.info({ ...cfg }, 'Alerting V2 workers registered');
    return {
        stop: async () => {
            await pgboss.unschedule(ALERT_JOBS.escalationSweep).catch(() => undefined);
            if (!alertDeliveryOnly) {
                await pgboss.unschedule(ALERT_JOBS.cleanup).catch(() => undefined);
            }
            for (const timer of runtimeTimers)
                clearInterval(timer);
        },
    };
}
function startRuntimeDispatchTimers(telemetryPool, log) {
    const dispatch = async (queue, cadenceSeconds) => {
        try {
            const orgs = await activeRuntimeOrganizations(telemetryPool);
            const bucket = Math.floor(Date.now() / (cadenceSeconds * 1000));
            await Promise.allSettled(orgs.map((organizationId) => pgboss.send(queue, { organizationId }, {
                singletonKey: `${queue}:${organizationId}:${bucket}`,
                expireInSeconds: Math.max(60, cadenceSeconds * 4),
                retryLimit: 2,
                retryDelay: 5,
                retryBackoff: true,
            })));
            if (orgs.length > 0)
                log.debug({ queue, orgs: orgs.length }, 'Runtime alert evaluation jobs dispatched');
        }
        catch (err) {
            log.warn({ err, queue }, 'Runtime alert evaluation dispatch failed');
        }
    };
    const timers = [
        setInterval(() => void dispatch(ALERT_JOBS.evaluateWindow, 5), 5_000),
        setInterval(() => void dispatch(ALERT_JOBS.evaluateOperational, 30), 30_000),
        setInterval(() => void dispatch(ALERT_JOBS.evaluateAi, 300), 300_000),
        setInterval(() => void pgboss.send(ALERT_JOBS.notificationRouter, {}, {
            singletonKey: `alert-notification-router:${Math.floor(Date.now() / 10_000)}`,
            expireInSeconds: 60,
        }).catch(() => undefined), 10_000),
        setInterval(() => void pgboss.send(ALERT_JOBS.telemetryOutboxRelay, {}, {
            singletonKey: `alert-telemetry-outbox:${Math.floor(Date.now() / 1_000)}`,
            expireInSeconds: 30,
        }).catch(() => undefined), 1_000),
    ];
    for (const timer of timers)
        timer.unref();
    void dispatch(ALERT_JOBS.evaluateWindow, 5);
    void dispatch(ALERT_JOBS.evaluateOperational, 30);
    void dispatch(ALERT_JOBS.evaluateAi, 300);
    return timers;
}
async function activeRuntimeOrganizations(telemetryPool) {
    try {
        const result = await telemetryPool.query(`SELECT DISTINCT organization_id
         FROM (
           SELECT organization_id FROM analytics_watermarks WHERE updated_at >= NOW() - INTERVAL '1 hour'
           UNION
           SELECT organization_id FROM request_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
           UNION
           SELECT organization_id FROM cron_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
           UNION
           SELECT organization_id FROM ai_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
         ) recent
        LIMIT 1000`);
        if (result.rows.length > 0) {
            return result.rows.map((row) => row.organization_id);
        }
    }
    catch {
        // If watermarks/metrics tables are not populated yet, fall back gracefully
    }
    // Fallback to recent telemetry events if aggregates are not present
    const fallbackResult = await telemetryPool.query(`SELECT DISTINCT organization_id
       FROM events_requests
      WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
      LIMIT 1000`).catch(() => ({ rows: [] }));
    return fallbackResult.rows.map((row) => row.organization_id);
}
async function safeCreateQueue(name, options, strict = false) {
    const boss = pgboss;
    if (typeof boss.createQueue !== 'function') {
        if (strict)
            throw new Error(`PgBoss queue factory is unavailable for required queue ${name}`);
        return;
    }
    if (strict) {
        await boss.createQueue(name, options);
        return;
    }
    await boss.createQueue(name, options).catch(() => undefined);
}
//# sourceMappingURL=queue.js.map