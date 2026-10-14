/**
 * Connector PGMQ queue wiring (Canonical V2 Delivery & Control Planes).
 *
 * TRANSPORT (notification delivery) - canonical V2 only:
 *   - connector_v2_<provider>       one consumer per registered provider
 *
 * CONTROL PLANE queues:
 *   - connector_health_check
 *   - connector_test
 *   - connector_secret_rotation
 *   - connector_oauth_refresh
 *   - connector_cleanup
 *   - connector_dead_letter_retry
 *   - connector_delivery_retry
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgmq, type PgmqMessage } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { sweepRateLimiter } from './runtime.js';
import { decryptConfig, encryptConfig } from './secrets/secret.service.js';
import { CONNECTOR_JOBS, connectorTransportQueue, providerFromTransportQueue } from './job.constants.js';
import type { ConnectorConfigRow, NotificationPayload, RequestMeta } from './types.js';
import { env } from '../../config/env.js';
import { listConnectorTypes } from './registry.js';
import type { Pool } from 'pg';
import { workerMetrics } from './metrics/worker-metrics.js';
import { pool, notificationPool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { AlertRuntimeRepository } from '../alerting/runtime/alert-runtime.repository.js';
import { NotificationEntitlementService } from '../alerting/runtime/notification-entitlement.service.js';
import { ConnectorGlobalGuards } from './runtime-global-guards.js';
import {
  isConnectorTransportJob,
  isManagedEmailJob,
  type ConnectorTransportJob,
  type ManagedEmailJobData,
} from './delivery/transport.types.js';
import { recordNotificationDelivery } from '../alerting/runtime/notification-metrics.js';
import { sendEmail } from '../../shared/email/mailer.js';
import {
  alertFiringTemplate,
  alertResolvedTemplate,
  latencyAlertTemplate,
  standardNotificationTemplate,
  type AlertSeverity,
  type EmailTemplate,
} from '../../shared/email/index.js';
import { ProjectOwnerRepository } from '../alerting/runtime/email-only-restricted-routing.js';
import { renderEnterpriseAlertEmail } from '../alerting/runtime/alert-notification-formatter.js';

export interface ConnectorSendJobData {
  organizationId: string;
  connectorId: string;
  payload: NotificationPayload;
  routeId?: string | null;
  projectChannel?: {
    userId?: string;
    channelId?: string;
    channelType?: string;
    destination?: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface ConnectorTestJobData {
  organizationId: string;
  connectorId: string;
}

export interface ConnectorSecretRotationJobData {
  organizationId: string;
  connectorId: string;
  config: Record<string, unknown>;
  actorUserId?: string | null;
}

export interface ConnectorOAuthRefreshJobData {
  organizationId: string;
  connectorId: string;
}

export interface ConnectorDeliveryRetryJobData {
  organizationId: string;
  deliveryId: string;
  actorUserId?: string | null;
}

export type ConnectorWorkerGroup = 'all' | 'alert-delivery';

export interface ConnectorWorkerConfig {
  group?: ConnectorWorkerGroup;
  strictQueueCreation?: boolean;
}

function toChannelKind(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (k.startsWith('connector.v2.')) return k.slice('connector.v2.'.length);
  if (k.startsWith('connector_v2_')) return k.slice('connector_v2_'.length);
  return k;
}

function resolveCredentialExpiry(normalized: Record<string, unknown>, currentExpiresAt: Date | null): Date | null {
  const raw = normalized.expires_at ?? normalized.expiresAt ?? normalized.token_expires_at ?? normalized.tokenExpiresAt;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? currentExpiresAt : raw;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return currentExpiresAt;
}

function workerMeta(actorUserId: string | null = null): RequestMeta {
  return {
    actorUserId,
    actorIp: '127.0.0.1',
    actorUserAgent: 'worker/connector-runtime',
    requestId: `req_worker_${Date.now()}`,
  };
}

function getProviderConcurrency(provider: string): number {
  switch (provider.toLowerCase()) {
    case 'slack': return env.CONNECTOR_CONCURRENCY_SLACK;
    case 'email': return env.CONNECTOR_CONCURRENCY_EMAIL;
    case 'webhook': return env.CONNECTOR_CONCURRENCY_WEBHOOK;
    case 'discord': return env.CONNECTOR_CONCURRENCY_DISCORD;
    case 'teams': return env.CONNECTOR_CONCURRENCY_TEAMS;
    case 'pagerduty': return env.CONNECTOR_CONCURRENCY_PAGERDUTY;
    case 'sms': return env.CONNECTOR_CONCURRENCY_SMS;
    default: return env.CONNECTOR_SEND_CONCURRENCY;
  }
}

function renderManagedAlertEmail(jobData: ManagedEmailJobData, targetEmail: string): EmailTemplate {
  return renderEnterpriseAlertEmail({
    payload: jobData.payload,
    organizationId: jobData.organizationId,
    projectId: jobData.projectId,
    alertKey: jobData.alertKey,
    alertEventId: jobData.alertEventId ?? undefined,
    severity: jobData.severity,
    ruleId: jobData.ruleId ?? undefined,
    deliveryMode: jobData.deliveryMode,
    recipientEmail: targetEmail,
  });
}

async function processManagedEmailJob(
  jobData: ManagedEmailJobData,
  jobId: string,
  runtimeRepository: AlertRuntimeRepository,
  notificationEntitlement: NotificationEntitlementService,
  owners: ProjectOwnerRepository,
  log: FastifyBaseLogger,
): Promise<void> {
  const startedAt = Date.now();
  const capability = await notificationEntitlement.resolve(jobData.organizationId);
  if (!capability.alertingEnabled && !capability.managedEmailEnabled) {
    await runtimeRepository.recordNotificationDelivery({
      organizationId: jobData.organizationId,
      jobId: jobData.notificationJobId,
      jobStatus: 'failed',
      attemptStatus: 'failed',
      errorCategory: 'DELIVERY_BLOCKED_ENTITLEMENT',
      errorMessage: 'Alerting is not enabled on this organization',
      latencyMs: Date.now() - startedAt,
    });
    recordNotificationDelivery('notification.delivery.entitlement_blocked');
    log.warn({ jobId, organizationId: jobData.organizationId }, 'Managed email blocked by entitlement');
    return;
  }

  let targetEmail = jobData.recipientEmail;
  if (jobData.deliveryMode === 'EMAIL_ONLY_RESTRICTED' && jobData.projectId) {
    const owner = await owners.findActiveVerifiedOwner(jobData.organizationId, jobData.projectId);
    if (owner) {
      targetEmail = owner.email;
    } else {
      const fallback = owners.findActiveVerifiedFallbackRecipient
        ? await owners.findActiveVerifiedFallbackRecipient(jobData.organizationId, jobData.projectId)
        : null;
      if (fallback) {
        targetEmail = fallback.email;
      } else {
        await runtimeRepository.recordNotificationDelivery({
          organizationId: jobData.organizationId,
          jobId: jobData.notificationJobId,
          jobStatus: 'failed',
          attemptStatus: 'failed',
          errorCategory: 'owner_email_unavailable',
          errorMessage: 'Neither project owner nor organization fallback email is available',
          latencyMs: Date.now() - startedAt,
        });
        recordNotificationDelivery('notification.delivery.owner_unavailable');
        return;
      }
    }
  }

  const template = renderManagedAlertEmail(jobData, targetEmail);

  try {
    await sendEmail({
      to: targetEmail,
      subject: template.subject,
      text: template.text,
      html: template.html,
    });

    await runtimeRepository.recordNotificationDelivery({
      organizationId: jobData.organizationId,
      jobId: jobData.notificationJobId,
      jobStatus: 'sent',
      attemptStatus: 'sent',
      latencyMs: Date.now() - startedAt,
    });
    recordNotificationDelivery('notification.delivery.sent');
    log.info(
      { jobId, notificationJobId: jobData.notificationJobId, organizationId: jobData.organizationId },
      'Managed email alert delivered successfully',
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isPermanent = errMsg.includes('invalid') || errMsg.includes('recipient') || errMsg.includes('550') || errMsg.includes('syntax');

    await runtimeRepository.recordNotificationDelivery({
      organizationId: jobData.organizationId,
      jobId: jobData.notificationJobId,
      jobStatus: isPermanent ? 'failed' : 'queued',
      attemptStatus: 'failed',
      errorCategory: isPermanent ? 'invalid_recipient' : 'transport',
      errorMessage: errMsg,
      latencyMs: Date.now() - startedAt,
    });
    recordNotificationDelivery('notification.delivery.failed');
    if (!isPermanent) throw err;
  }
}

export async function registerConnectorWorkers(
  logger: FastifyBaseLogger,
  runtimeRepository: AlertRuntimeRepository = new AlertRuntimeRepository(logDB.getPrimaryPool()),
  config: ConnectorWorkerConfig = {},
  primaryPool: Pool = notificationPool ?? pool,
): Promise<{ stop: () => Promise<void> }> {
  const alertDeliveryOnly = config.group === 'alert-delivery';
  const log = logger.child({ component: 'connector-workers', group: config.group ?? 'all' });
  const repository = new ConnectorRepository();
  const notificationEntitlement = new NotificationEntitlementService();
  const owners = new ProjectOwnerRepository(primaryPool);
  const globalGuards = new ConnectorGlobalGuards(primaryPool);
  const dispatcher = new NotificationDispatcher(repository, logger);
  const service = new ConnectorService({
    repository,
    dispatcher,
    notificationEntitlement,
    logger,
    emitEvent: async () => undefined,
  });
  const monitor = new ConnectorMonitor(repository, dispatcher, service, logger, {}, notificationEntitlement);

  const baseQueues = alertDeliveryOnly
    ? [CONNECTOR_JOBS.deliveryRetry]
    : Object.values(CONNECTOR_JOBS);
  const connectorTypes = listConnectorTypes();
  const transportQueues = connectorTypes.map((t) => connectorTransportQueue(t.type));
  const registeredQueueNames = [...baseQueues, ...transportQueues];

  await Promise.all(registeredQueueNames.map((queue) => pgmq.createQueue(queue)));

  const circuitProbeTimer = setInterval(async () => {
    try {
      const recovered = await globalGuards.probeOpenCircuits(env.CONNECTOR_CIRCUIT_RESET_SECONDS);
      if (recovered > 0) {
        log.info({ recovered }, 'Circuit breaker probe transitioned open circuits to half_open');
      }
    } catch (err) {
      log.warn({ err }, 'Circuit breaker probe sweep failed');
    }
  }, 60_000);
  circuitProbeTimer.unref();

  const workers: PgmqWorker[] = [];

  // ── Transport Workers ───────────────────────────────────────────────────
  await Promise.all(
    transportQueues.map(async (queue) => {
      const providerType = providerFromTransportQueue(queue);
      const concurrency = getProviderConcurrency(providerType);

      const worker = new PgmqWorker(
        pgmq,
        async (msg: PgmqMessage<any>) => {
          const jobData = msg.message;
          const jobId = msg.msgId;

          if (isManagedEmailJob(jobData)) {
            await processManagedEmailJob(jobData, jobId, runtimeRepository, notificationEntitlement, owners, log);
            return;
          }
          if (!isConnectorTransportJob(jobData)) {
            log.error({ jobId }, 'Rejected connector transport job with invalid contract');
            return;
          }

          const channelKind = toChannelKind(jobData.channelKind);
          const capability = await notificationEntitlement.resolve(jobData.organizationId);
          if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess || !capability.isProviderAllowed(channelKind as any)) {
            await runtimeRepository.recordNotificationDelivery({
              organizationId: jobData.organizationId,
              jobId: jobData.notificationJobId,
              jobStatus: 'failed',
              attemptStatus: 'failed',
              errorCategory: 'DELIVERY_BLOCKED_ENTITLEMENT',
              errorMessage: 'Connector entitlement is unavailable for delivery',
            });
            recordNotificationDelivery('notification.delivery.entitlement_blocked');
            log.warn({ jobId, channelKind }, 'Connector transport blocked by entitlement');
            return;
          }

          const row = await repository.findById(jobData.organizationId, jobData.connectorId);
          if (!row || row.status !== 'active' || row.organization_id !== jobData.organizationId) {
            await runtimeRepository.recordNotificationDelivery({
              organizationId: jobData.organizationId,
              jobId: jobData.notificationJobId,
              jobStatus: 'failed',
              attemptStatus: 'failed',
              errorCategory: 'connector_unavailable',
              errorMessage: 'Connector is missing, inactive, or tenant mismatched',
            });
            log.warn({ jobId, connectorId: jobData.connectorId }, 'Connector transport skipped: inactive or tenant mismatched');
            return;
          }

          if (env.CONNECTOR_GLOBAL_LIMITS) {
            const guard = await globalGuards.acquire(jobData.connectorId, {
              limit: env.CONNECTOR_GLOBAL_LIMIT,
              windowSeconds: env.CONNECTOR_GLOBAL_WINDOW_SECONDS,
              failureThreshold: env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD,
              resetSeconds: env.CONNECTOR_CIRCUIT_RESET_SECONDS,
            });
            if (!guard.allowed) {
              await runtimeRepository.recordNotificationDelivery({
                organizationId: jobData.organizationId,
                jobId: jobData.notificationJobId,
                jobStatus: 'queued',
                attemptStatus: 'failed',
                errorCategory: guard.circuitState === 'open' ? 'circuit_open' : 'rate_limit',
                errorMessage: `Delivery deferred by global guard (circuit=${guard.circuitState})`,
              });
              recordNotificationDelivery('notification.delivery.rate_limited');
              return;
            }
          }

          const outcome = await dispatcher.dispatch(row, jobData.payload as unknown as NotificationPayload, { routeId: null });
          const succeeded = outcome.status === 'sent';
          const retryable = outcome.result.retryable === true;
          await runtimeRepository.recordNotificationDelivery({
            organizationId: jobData.organizationId,
            jobId: jobData.notificationJobId,
            jobStatus: succeeded ? 'sent' : retryable ? 'queued' : 'failed',
            attemptStatus: succeeded ? 'sent' : 'failed',
            errorCategory: succeeded ? null : outcome.result.failureCategory ?? 'transport',
            errorMessage: succeeded ? null : outcome.result.errorMessage ?? 'Connector delivery deferred or failed',
            latencyMs: outcome.result.latencyMs,
            externalMessageId: outcome.result.externalMessageId ?? null,
            responseStatusCode: outcome.result.statusCode ?? null,
          });

          if (succeeded) await globalGuards.recordSuccess(jobData.connectorId);
          else await globalGuards.recordFailure(jobData.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
        },
        {
          queue,
          concurrency,
          batchSize: env.CONNECTOR_SEND_BATCH_SIZE,
          visibilityTimeoutSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
        },
      );

      await worker.start();
      workers.push(worker);
    }),
  );

  // ── Delivery Retry Worker ───────────────────────────────────────────────
  const retryWorker = new PgmqWorker(
    pgmq,
    async () => {
      await monitor.processRetries();
      sweepRateLimiter();
    },
    { queue: CONNECTOR_JOBS.deliveryRetry, batchSize: 1, concurrency: 2 },
  );

  const controlWorkers: PgmqWorker[] = [retryWorker];

  if (!alertDeliveryOnly) {
    // ── Health Check Worker ───────────────────────────────────────────────
    const healthWorker = new PgmqWorker(
      pgmq,
      async () => {
        await monitor.runHealthChecks();
      },
      { queue: CONNECTOR_JOBS.healthCheck, batchSize: 1, concurrency: 1 },
    );
    controlWorkers.push(healthWorker);

    // ── Test Worker ───────────────────────────────────────────────────────
    const testWorker = new PgmqWorker(
      pgmq,
      async (msg: PgmqMessage<ConnectorTestJobData>) => {
        const { organizationId, connectorId } = msg.message;
        const row = await repository.findById(organizationId, connectorId);
        if (!row) return;

        const capability = await notificationEntitlement.resolve(organizationId);
        if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess || !capability.isProviderAllowed(row.type, true)) {
          recordNotificationDelivery('notification.delivery.entitlement_blocked');
          return;
        }
        const result = await service.runConnectionTest(row, null);
        await repository.insertAuditLog({
          organizationId,
          connectorId,
          action: 'test.completed',
          actorId: null,
          changesSummary: { success: result.success },
        });
      },
      { queue: CONNECTOR_JOBS.test, batchSize: 3, concurrency: 3 },
    );
    controlWorkers.push(testWorker);

    // ── Secret Rotation Worker ────────────────────────────────────────────
    const rotWorker = new PgmqWorker(
      pgmq,
      async (msg: PgmqMessage<ConnectorSecretRotationJobData>) => {
        const { organizationId, connectorId, config: newConfig, actorUserId } = msg.message;
        await service.rotateSecret(organizationId, workerMeta(actorUserId ?? null), connectorId, { config: newConfig });
      },
      { queue: CONNECTOR_JOBS.secretRotation, batchSize: 2, concurrency: 2 },
    );
    controlWorkers.push(rotWorker);

    // ── OAuth Refresh Worker ──────────────────────────────────────────────
    const oauthWorker = new PgmqWorker(
      pgmq,
      async (msg: PgmqMessage<ConnectorOAuthRefreshJobData>) => {
        const { organizationId, connectorId } = msg.message;
        const row = await repository.findById(organizationId, connectorId);
        if (!row) return;

        const capability = await notificationEntitlement.resolve(organizationId);
        if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess || !capability.isProviderAllowed(row.type, true)) {
          recordNotificationDelivery('notification.delivery.entitlement_blocked');
          return;
        }

        const credential = await repository.getCredential(organizationId, connectorId, 'oauth');
        if (!credential || credential.credential_type !== 'oauth') return;

        const connector = await dispatcher.instantiate(row);
        const currentCredential = decryptConfig(credential.encrypted_value);
        const refreshed = await connector.refreshCredentials(currentCredential);
        if (!refreshed.valid) return;

        if (refreshed.normalized) {
          const expiresAt = resolveCredentialExpiry(refreshed.normalized, credential.expires_at);
          await repository.upsertCredential({
            organizationId,
            connectorId,
            credentialType: credential.credential_type,
            keyName: credential.key_name,
            encryptedValue: encryptConfig(refreshed.normalized),
            expiresAt,
            actorUserId: null,
          });
        }
        await repository.insertAuditLog({
          organizationId,
          connectorId,
          action: 'oauth.refreshed',
          actorId: null,
        });
      },
      { queue: CONNECTOR_JOBS.oauthRefresh, batchSize: 3, concurrency: 3 },
    );
    controlWorkers.push(oauthWorker);

    // ── Cleanup Worker ────────────────────────────────────────────────────
    const cleanupWorker = new PgmqWorker(
      pgmq,
      async () => {
        const expiredOAuthStates = await repository.cleanupExpiredOAuthStates();
        if (expiredOAuthStates > 0) {
          log.info({ expiredOAuthStates }, 'Connector cleanup removed expired OAuth states');
        }
      },
      { queue: CONNECTOR_JOBS.cleanup, batchSize: 1, concurrency: 1 },
    );
    controlWorkers.push(cleanupWorker);

    // ── Dead Letter Retry Worker ──────────────────────────────────────────
    const deadLetterWorker = new PgmqWorker(
      pgmq,
      async (msg: PgmqMessage<ConnectorDeliveryRetryJobData>) => {
        const { organizationId, deliveryId, actorUserId } = msg.message;
        const delivery = await repository.retryDelivery(organizationId, deliveryId);
        if (!delivery) return;

        await repository.insertAuditLog({
          organizationId,
          connectorId: delivery.connector_id,
          action: 'delivery.dead_letter_retry_requested',
          actorId: actorUserId ?? null,
          changesSummary: { deliveryId: delivery.id },
        });

        await pgmq.send(
          CONNECTOR_JOBS.deliveryRetry,
          { organizationId, deliveryId: delivery.id },
          { delaySeconds: 0 },
        );
      },
      { queue: CONNECTOR_JOBS.deadLetterRetry, batchSize: 3, concurrency: 3 },
    );
    controlWorkers.push(deadLetterWorker);
  }

  await Promise.all(
    controlWorkers.map(async (worker) => {
      await worker.start();
      workers.push(worker);
    }),
  );

  // ── Dispatch Intervals ──────────────────────────────────────────────────
  const dispatchTimers = [
    setInterval(() => void pgmq.send(CONNECTOR_JOBS.deliveryRetry, {}).catch(() => undefined), 60_000),
  ];
  if (!alertDeliveryOnly) {
    dispatchTimers.push(
      setInterval(() => void pgmq.send(CONNECTOR_JOBS.healthCheck, {}).catch(() => undefined), 300_000),
      setInterval(() => void pgmq.send(CONNECTOR_JOBS.cleanup, {}).catch(() => undefined), 3600_000),
    );
  }
  for (const timer of dispatchTimers) timer.unref();

  log.info({ queues: registeredQueueNames.length, workers: workers.length }, 'Connector PGMQ workers registered');

  return {
    stop: async () => {
      clearInterval(circuitProbeTimer);
      for (const t of dispatchTimers) clearInterval(t);
      await Promise.all(workers.map((w) => w.stop()));
    },
  };
}
