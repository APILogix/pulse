/**
 * Alerting pg-boss queue wiring (Alerting V2 Canonical Architecture).
 *
 * Canonical queues:
 *   - alert.telemetry-outbox-relay (relays fast telemetry outbox events)
 *   - alert.evaluate.fast          (fast path rule evaluator)
 *   - alert.evaluate.window        (periodic 5s window evaluator)
 *   - alert.evaluate.operational   (periodic 30s system metrics evaluator)
 *   - alert.evaluate.ai            (periodic 300s AI evaluator)
 *   - alert.error-group-regressed  (fast evaluation on error regressions)
 *   - alert.notification-router    (claims notification jobs & dispatches to connector queues)
 *   - alert.escalate               (snapshot escalation evaluator)
 *   - alert.escalation-sweep       (advances due escalations)
 *   - alert.cleanup                (daily retention purge)
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../lib/pgboss.js';
import { env } from '../../config/env.js';
import { pool } from '../../config/database.js';
import { AlertingRepository } from './repository.js';
import { AlertEscalationSweep } from './escalation.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { AlertRuntimeEngines, type FastEvaluationInput } from './runtime/engines.js';
import { NotificationRoutingService } from './runtime/notification-routing.service.js';
import { AlertChannelRepository } from '../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from './config/alert-config.repository.js';
import { AlertNotificationRouter } from './runtime/notification-router.js';
import { TelemetryOutboxRelay } from './runtime/telemetry-outbox-relay.js';
import { SnapshotEscalationWorker } from './escalation/escalation.worker.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';

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
} as const;

export interface AlertingWorkerConfig {
  sweepClaimLimit?: number;
  retentionResolvedEventsDays?: number;
  retentionBatchesDays?: number;
  retentionDeliveryAttemptsDays?: number;
  retentionDeadLettersDays?: number;
}

const DEFAULTS: Required<AlertingWorkerConfig> = {
  sweepClaimLimit: 200,
  retentionResolvedEventsDays: 30,
  retentionBatchesDays: 14,
  retentionDeliveryAttemptsDays: 30,
  retentionDeadLettersDays: 30,
};

interface MinimalJob<T> { id: string; data: T }

function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
}

/**
 * Register all Alerting V2 pg-boss workers + timers. Idempotent per process.
 */
export async function registerAlertingWorkers(
  logger: FastifyBaseLogger,
  config: AlertingWorkerConfig = {},
  _projectSubscriptionResolver?: unknown,
  telemetryPool?: Pool,
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULTS, ...config };
  const log = logger.child({ component: 'alerting-workers' });

  const alertRepo = new AlertingRepository();
  const connectorRepo = new ConnectorRepository();
  const enqueueConnectorJob = async (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) =>
    pgboss.send(queue, data, options as never);
  const entitlement = new NotificationEntitlementService();
  const runtimePool = telemetryPool ?? pool;
  const routing = new NotificationRoutingService({
    logger,
    channelRepository: new AlertChannelRepository(pool),
    configRepository: new AlertConfigRepository(pool),
    entitlementService: entitlement,
  });

  const escalationSweep = new AlertEscalationSweep(alertRepo, connectorRepo, enqueueConnectorJob, logger);

  // ── Queue creation with enterprise defaults ─────────────────────────────
  await safeCreateQueue(ALERT_JOBS.cleanup);
  await safeCreateQueue(ALERT_JOBS.escalate);
  await safeCreateQueue(ALERT_JOBS.escalationSweep);
  await safeCreateQueue(ALERT_JOBS.evaluateFast);
  await safeCreateQueue(ALERT_JOBS.evaluateWindow);
  await safeCreateQueue(ALERT_JOBS.evaluateOperational);
  await safeCreateQueue(ALERT_JOBS.evaluateAi);
  await safeCreateQueue(ALERT_JOBS.notificationRouter);
  await safeCreateQueue(ALERT_JOBS.telemetryOutboxRelay);
  await safeCreateQueue(ALERT_JOBS.errorGroupRegressed, {
    retryLimit: 3,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: 300,
  });

  const runtimeEngines = new AlertRuntimeEngines(logger, runtimePool, pool, routing);
  const notificationRouter = new AlertNotificationRouter(runtimePool, logger);
  const telemetryOutboxRelay = new TelemetryOutboxRelay(runtimePool, logger);
  const snapshotEscalation = new SnapshotEscalationWorker(logger, runtimePool, routing);

  // ── escalation-sweep: advance due escalations + resume expired acks ─────
  await pgboss.work(
    ALERT_JOBS.escalationSweep,
    {} as never,
    (async () => {
      await escalationSweep.run(cfg.sweepClaimLimit);
    }) as never,
  );

  // ── cleanup: retention purge ────────────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.cleanup,
    {} as never,
    (async () => {
      const [events, batches, attempts, deadLetters, throttles] = await Promise.all([
        alertRepo.purgeOldTerminalEvents(cfg.retentionResolvedEventsDays),
        alertRepo.purgeOldBatches(cfg.retentionBatchesDays),
        alertRepo.purgeOldDeliveryAttempts(cfg.retentionDeliveryAttemptsDays),
        alertRepo.purgeOldDeadLetters(cfg.retentionDeadLettersDays),
        alertRepo.purgeOldThrottleWindows(),
      ]);
      log.info(
        { events, batches, attempts, deadLetters, throttles },
        'Alerting retention cleanup finished',
      );
    }) as never,
  );

  // ── Snapshot escalation worker ──────────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.escalate,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      if (!env.ESCALATION_V2) return;
      const jobs = allJobs<Parameters<SnapshotEscalationWorker['run']>[0]>(arg);
      await Promise.all(jobs.map((job) => snapshotEscalation.run(job.data)));
    }) as never,
  );

  // ── Canonical V2 fast evaluator ─────────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.evaluateFast,
    { localConcurrency: 8, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<FastEvaluationInput>(arg);
      await Promise.all(jobs.map((job) => runtimeEngines.evaluateFast(job.data)));
    }) as never,
  );

  // ── Canonical V2 window tier evaluator ──────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.evaluateWindow,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'window' }),
      ));
    }) as never,
  );

  // ── Canonical V2 operational tier evaluator ─────────────────────────────
  await pgboss.work(
    ALERT_JOBS.evaluateOperational,
    { localConcurrency: 3, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'operational' }),
      ));
    }) as never,
  );

  // ── Canonical V2 AI tier evaluator ──────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.evaluateAi,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ organizationId: string }>(arg);
      await Promise.all(jobs.map((job) =>
        runtimeEngines.evaluateTier({ organizationId: job.data.organizationId, tier: 'ai' }),
      ));
    }) as never,
  );

  // ── Canonical V2 notification router ────────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.notificationRouter,
    { localConcurrency: 5, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<{ notificationJobId?: string }>(arg);
      await Promise.all(jobs.map((job) =>
        job.data.notificationJobId
          ? notificationRouter.dispatchById(job.data.notificationJobId)
          : notificationRouter.run(100),
      ));
    }) as never,
  );

  // ── Canonical V2 telemetry outbox relay ─────────────────────────────────
  await pgboss.work(
    ALERT_JOBS.telemetryOutboxRelay,
    { localConcurrency: 2, batchSize: 1 } as never,
    (async () => {
      await telemetryOutboxRelay.run(250);
    }) as never,
  );

  // ── Canonical V2 error regression evaluator ─────────────────────────────
  await pgboss.work(
    ALERT_JOBS.errorGroupRegressed,
    { localConcurrency: 4, batchSize: 1 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<Record<string, unknown>>(arg);
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
        } as never);
      }));
    }) as never,
  );

  // ── Schedules (cron & timers) ───────────────────────────────────────────
  await pgboss.schedule(ALERT_JOBS.escalationSweep, '* * * * *', {}, { singletonKey: 'alert-escalation-sweep' } as never);
  await pgboss.schedule(ALERT_JOBS.cleanup, '17 3 * * *', {}, { singletonKey: 'alert-cleanup' } as never);

  const runtimeTimers = startRuntimeDispatchTimers(runtimePool, log);

  log.info({ ...cfg }, 'Alerting V2 workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(ALERT_JOBS.escalationSweep).catch(() => undefined);
      await pgboss.unschedule(ALERT_JOBS.cleanup).catch(() => undefined);
      for (const timer of runtimeTimers) clearInterval(timer);
    },
  };
}

function startRuntimeDispatchTimers(telemetryPool: Pool, log: FastifyBaseLogger): NodeJS.Timeout[] {
  const dispatch = async (
    queue: typeof ALERT_JOBS.evaluateWindow | typeof ALERT_JOBS.evaluateOperational | typeof ALERT_JOBS.evaluateAi,
    cadenceSeconds: number,
  ): Promise<void> => {
    try {
      const orgs = await activeRuntimeOrganizations(telemetryPool);
      const bucket = Math.floor(Date.now() / (cadenceSeconds * 1000));
      await Promise.allSettled(orgs.map((organizationId) =>
        pgboss.send(
          queue,
          { organizationId },
          {
            singletonKey: `${queue}:${organizationId}:${bucket}`,
            expireInSeconds: Math.max(60, cadenceSeconds * 4),
            retryLimit: 2,
            retryDelay: 5,
            retryBackoff: true,
          } as never,
        ),
      ));
      if (orgs.length > 0) log.debug({ queue, orgs: orgs.length }, 'Runtime alert evaluation jobs dispatched');
    } catch (err) {
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
    } as never).catch(() => undefined), 10_000),
    setInterval(() => void pgboss.send(ALERT_JOBS.telemetryOutboxRelay, {}, {
      singletonKey: `alert-telemetry-outbox:${Math.floor(Date.now() / 1_000)}`,
      expireInSeconds: 30,
    } as never).catch(() => undefined), 1_000),
  ];
  for (const timer of timers) timer.unref();

  void dispatch(ALERT_JOBS.evaluateWindow, 5);
  void dispatch(ALERT_JOBS.evaluateOperational, 30);
  void dispatch(ALERT_JOBS.evaluateAi, 300);
  return timers;
}

async function activeRuntimeOrganizations(telemetryPool: Pool): Promise<string[]> {
  const result = await telemetryPool.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM (
         SELECT organization_id FROM events_requests WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_errors WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_logs WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM events_cron_checkins WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
         UNION
         SELECT organization_id FROM ai_requests WHERE updated_at >= NOW() - INTERVAL '15 minutes'
       ) recent
      LIMIT 1000`,
  );
  return result.rows.map((row) => row.organization_id);
}

async function safeCreateQueue(name: string, options?: Record<string, unknown>): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string, o?: Record<string, unknown>) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name, options).catch(() => undefined);
  }
}
