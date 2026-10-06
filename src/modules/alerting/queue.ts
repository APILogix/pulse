/**
 * Alerting pgmq queue wiring (Alerting V2 Canonical Architecture).
 *
 * Canonical queues:
 *   - alert_telemetry_outbox_relay (relays fast telemetry outbox events)
 *   - alert_evaluate_fast          (fast path rule evaluator)
 *   - alert_evaluate_window        (periodic 5s window evaluator)
 *   - alert_evaluate_operational   (periodic 30s system metrics evaluator)
 *   - alert_evaluate_ai            (periodic 300s AI evaluator)
 *   - alert_error_group_regressed  (fast evaluation on error regressions)
 *   - alert_notification_router    (claims notification jobs & dispatches to connector queues)
 *   - alert_escalate               (snapshot escalation evaluator)
 *   - alert_escalation_sweep       (advances due escalations)
 *   - alert_auto_resolve_sweep     (closes alerts past auto_resolve_at)
 *   - alert_cleanup                (daily retention purge)
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgmq, type PgmqMessage } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
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
import { AlertDomainOutboxRelay } from './runtime/alert-domain-outbox-relay.js';
import { SnapshotEscalationWorker } from './escalation/escalation.worker.js';
import { AlertAutoResolveSweep } from './runtime/auto-resolve-sweep.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';
import { EmailOnlyRestrictedRouting, ProjectOwnerRepository } from './runtime/email-only-restricted-routing.js';
import { ALERT_JOBS, ALERT_DELIVERY_WORKER_JOBS } from './queue-names.js';

export { ALERT_JOBS, ALERT_DELIVERY_WORKER_JOBS } from './queue-names.js';

export type AlertingWorkerGroup = 'all' | 'alert-delivery';

export interface AlertingWorkerConfig {
  group?: AlertingWorkerGroup;
  strictQueueCreation?: boolean;
  sweepClaimLimit?: number;
  retentionResolvedEventsDays?: number;
  retentionBatchesDays?: number;
  retentionDeliveryAttemptsDays?: number;
  retentionDeadLettersDays?: number;
}

const DEFAULTS = {
  group: 'all' as AlertingWorkerGroup,
  strictQueueCreation: false,
  sweepClaimLimit: 200,
  retentionResolvedEventsDays: 30,
  retentionBatchesDays: 14,
  retentionDeliveryAttemptsDays: 30,
  retentionDeadLettersDays: 30,
};

/**
 * Register all Alerting V2 PGMQ workers + dispatch intervals.
 */
export async function registerAlertingWorkers(
  logger: FastifyBaseLogger,
  config: AlertingWorkerConfig = {},
  _projectSubscriptionResolver?: unknown,
  telemetryPool?: Pool,
): Promise<{ stop: () => Promise<void> }> {
  const cfg = { ...DEFAULTS, ...config };
  const alertDeliveryOnly = cfg.group === 'alert-delivery';
  const log = logger.child({ component: 'alerting-workers', group: cfg.group });

  const alertRepo = new AlertingRepository();
  const connectorRepo = new ConnectorRepository();
  const enqueueConnectorJob = async (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => {
    const queueName = queue.replace(/\./g, '_');
    return pgmq.send(queueName, data, { delaySeconds: typeof options?.delaySeconds === 'number' ? options.delaySeconds : 0 });
  };

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

  // ── Provision Queues ──────────────────────────────────────────────────
  const alertJobs = alertDeliveryOnly
    ? ALERT_DELIVERY_WORKER_JOBS
    : Object.values(ALERT_JOBS);

  await pgmq.createQueues([...alertJobs], { concurrency: 4 });

  const runtimeEngines = new AlertRuntimeEngines(logger, runtimePool, pool, routing);
  const notificationRouter = new AlertNotificationRouter(runtimePool, logger, projectOwners);
  const telemetryOutboxRelay = new TelemetryOutboxRelay(runtimePool, logger);
  const alertDomainOutboxRelay = new AlertDomainOutboxRelay(runtimePool, logger);
  const snapshotEscalation = new SnapshotEscalationWorker(logger, runtimePool, routing);
  const autoResolveSweep = new AlertAutoResolveSweep(runtimePool, logger);

  const workers: PgmqWorker[] = [];

  // ── escalation-sweep worker ─────────────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async () => {
      await escalationSweep.run(cfg.sweepClaimLimit);
    },
    { queue: ALERT_JOBS.escalationSweep, batchSize: 1, concurrency: 1 },
  ));

  // ── auto-resolve-sweep worker ───────────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async () => {
      await autoResolveSweep.run(cfg.sweepClaimLimit);
    },
    { queue: ALERT_JOBS.autoResolveSweep, batchSize: 1, concurrency: 1 },
  ));

  // ── cleanup: retention purge ────────────────────────────────────────────
  if (!alertDeliveryOnly) {
    workers.push(new PgmqWorker(
      pgmq,
      async () => {
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
      },
      { queue: ALERT_JOBS.cleanup, batchSize: 1, concurrency: 1 },
    ));
  }

  // ── Snapshot escalation worker ──────────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<Parameters<SnapshotEscalationWorker['run']>[0]>) => {
      if (!env.ESCALATION_V2) return;
      await snapshotEscalation.run(msg.message);
    },
    { queue: ALERT_JOBS.escalate, batchSize: 1, concurrency: 4 },
  ));

  // ── Canonical V2 fast evaluator ─────────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<FastEvaluationInput>) => {
      await runtimeEngines.evaluateFast(msg.message);
    },
    { queue: ALERT_JOBS.evaluateFast, batchSize: 1, concurrency: 8 },
  ));

  // ── Canonical V2 window tier evaluator ──────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<{ organizationId: string }>) => {
      await runtimeEngines.evaluateTier({ organizationId: msg.message.organizationId, tier: 'window' });
    },
    { queue: ALERT_JOBS.evaluateWindow, batchSize: 1, concurrency: 4 },
  ));

  // ── Canonical V2 operational tier evaluator ─────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<{ organizationId: string }>) => {
      await runtimeEngines.evaluateTier({ organizationId: msg.message.organizationId, tier: 'operational' });
    },
    { queue: ALERT_JOBS.evaluateOperational, batchSize: 1, concurrency: 3 },
  ));

  // ── Canonical V2 AI tier evaluator ──────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<{ organizationId: string }>) => {
      await runtimeEngines.evaluateTier({ organizationId: msg.message.organizationId, tier: 'ai' });
    },
    { queue: ALERT_JOBS.evaluateAi, batchSize: 1, concurrency: 2 },
  ));

  // ── Canonical V2 notification router ────────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<{ notificationJobId?: string }>) => {
      if (msg.message.notificationJobId) {
        await notificationRouter.dispatchById(msg.message.notificationJobId);
      } else {
        await notificationRouter.run(100);
      }
    },
    { queue: ALERT_JOBS.notificationRouter, batchSize: 1, concurrency: 5 },
  ));

  // ── Canonical V2 telemetry outbox relay ─────────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async () => {
      await telemetryOutboxRelay.run(250);
    },
    { queue: ALERT_JOBS.telemetryOutboxRelay, batchSize: 1, concurrency: 2 },
  ));

  // ── Alerting -> automation domain event outbox relay ────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async () => {
      await alertDomainOutboxRelay.run(100);
    },
    { queue: ALERT_JOBS.alertDomainOutboxRelay, batchSize: 1, concurrency: 2 },
  ));

  // ── Canonical V2 error regression evaluator ─────────────────────────────
  workers.push(new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<Record<string, unknown>>) => {
      const payload = msg.message;
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
    },
    { queue: ALERT_JOBS.errorGroupRegressed, batchSize: 1, concurrency: 4 },
  ));

  await Promise.all(workers.map((worker) => worker.start()));

  // ── Runtime Dispatch Timers ─────────────────────────────────────────────
  const runtimeTimers = startRuntimeDispatchTimers(runtimePool, log);

  log.info({ ...cfg, workers: workers.length }, 'Alerting V2 PGMQ workers registered');

  return {
    stop: async () => {
      for (const timer of runtimeTimers) clearInterval(timer);
      await Promise.all(workers.map((w) => w.stop()));
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
      await Promise.allSettled(orgs.map((organizationId) =>
        pgmq.send(queue, { organizationId }),
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
    setInterval(() => void pgmq.send(ALERT_JOBS.notificationRouter, {}).catch(() => undefined), 10_000),
    setInterval(() => void pgmq.send(ALERT_JOBS.telemetryOutboxRelay, {}).catch(() => undefined), 1_000),
    setInterval(() => void pgmq.send(ALERT_JOBS.alertDomainOutboxRelay, {}).catch(() => undefined), 1_000),
    setInterval(() => void pgmq.send(ALERT_JOBS.escalationSweep, {}).catch(() => undefined), 60_000),
    setInterval(() => void pgmq.send(ALERT_JOBS.autoResolveSweep, {}).catch(() => undefined), 60_000),
  ];

  for (const timer of timers) timer.unref();

  void dispatch(ALERT_JOBS.evaluateWindow, 5);
  void dispatch(ALERT_JOBS.evaluateOperational, 30);
  void dispatch(ALERT_JOBS.evaluateAi, 300);
  return timers;
}

async function activeRuntimeOrganizations(telemetryPool: Pool): Promise<string[]> {
  try {
    const result = await telemetryPool.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id
         FROM (
           SELECT organization_id FROM analytics_watermarks WHERE updated_at >= NOW() - INTERVAL '1 hour'
           UNION
           SELECT organization_id FROM request_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
           UNION
           SELECT organization_id FROM cron_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
           UNION
           SELECT organization_id FROM ai_metrics_1m WHERE bucket >= NOW() - INTERVAL '15 minutes'
         ) recent
        LIMIT 1000`,
    );
    if (result.rows.length > 0) {
      return result.rows.map((row) => row.organization_id);
    }
  } catch {}

  const fallbackResult = await telemetryPool.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM events_requests
      WHERE ingested_at >= NOW() - INTERVAL '15 minutes'
      LIMIT 1000`,
  ).catch(() => ({ rows: [] }));
  return fallbackResult.rows.map((row) => row.organization_id);
}
