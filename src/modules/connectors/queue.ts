/**
 * Connector pg-boss queue wiring.
 *
 * TRANSPORT (notification delivery) - canonical V2 only:
 *   - connector.v2.<provider>       one consumer per registered provider
 *
 * There is exactly ONE transport implementation. The former
 * `connector-send-<provider>` family was a second, parallel transport with
 * weaker tenant verification and a circuit guard that was written but never
 * enforced; it has been removed rather than feature-flagged off, so it cannot be
 * accidentally reactivated.
 *
 * CONTROL PLANE queues:
 *   - connector-health-check
 *   - connector-test
 *   - connector-secret-rotation
 *   - connector-oauth-refresh
 *   - connector-cleanup
 *   - connector-dead-letter-retry
 *   - connector-delivery-retry
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../lib/pgboss.js';
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
import { workerMetrics } from './metrics/worker-metrics.js';
import { pool } from '../../config/database.js';
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

interface MinimalJob<T> { id: string; data: T }

function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
}

async function safeCreateQueue(name: string, strict = false): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue !== 'function') {
    if (strict) throw new Error(`PgBoss queue factory is unavailable for required queue ${name}`);
    return;
  }
  if (strict) {
    await boss.createQueue(name);
    return;
  }
  await Promise.resolve(boss.createQueue(name)).catch(() => undefined);
}

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

export interface ConnectorDeliveryRetryJobData {
  organizationId: string;
  deliveryId: string;
  actorUserId?: string | null;
}

export type ConnectorWorkerGroup = 'all' | 'alert-delivery';

export interface ConnectorOAuthRefreshJobData {
  organizationId: string;
  connectorId: string;
}

export interface ConnectorWorkerConfig {
  group?: ConnectorWorkerGroup;
  strictQueueCreation?: boolean;
}

function workerMeta(actorUserId: string | null = null): RequestMeta {
  return {
    actorUserId,
    actorIp: '127.0.0.1',
    actorUserAgent: 'connector-worker',
    requestId: '00000000-0000-0000-0000-000000000000',
  };
}

function resolveCredentialExpiry(config: Record<string, unknown>, fallback: Date | null): Date | null {
  const raw = config.expiresAt;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function payloadWithProjectChannel(job: ConnectorSendJobData): NotificationPayload {
  if (!job.projectChannel) return job.payload;
  return {
    ...job.payload,
    metadata: {
      ...(job.payload.metadata ?? {}),
      projectChannel: {
        ...(job.projectChannel.metadata ?? {}),
        userId: job.projectChannel.userId,
        channelId: job.projectChannel.channelId,
        channelType: job.projectChannel.channelType,
        destination: job.projectChannel.destination ?? null,
      },
    },
  };
}

function toChannelKind(value: string): 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'webhook' | 'sms' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'email' || normalized === 'slack' || normalized === 'discord'
    || normalized === 'teams' || normalized === 'pagerduty' || normalized === 'webhook'
    || normalized === 'sms') return normalized;
  throw new Error(`Unsupported connector provider: ${value}`);
}

function getProviderConcurrency(type: string): number {
  const norm = type.trim().toLowerCase();
  if (norm === 'slack') return env.CONNECTOR_CONCURRENCY_SLACK;
  if (norm === 'email') return env.CONNECTOR_CONCURRENCY_EMAIL;
  if (norm === 'webhook') return env.CONNECTOR_CONCURRENCY_WEBHOOK;
  if (norm === 'discord') return env.CONNECTOR_CONCURRENCY_DISCORD;
  if (norm === 'teams') return env.CONNECTOR_CONCURRENCY_TEAMS;
  if (norm === 'pagerduty') return env.CONNECTOR_CONCURRENCY_PAGERDUTY;
  if (norm === 'sms') return env.CONNECTOR_CONCURRENCY_SMS;
  return env.CONNECTOR_SEND_CONCURRENCY;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function renderManagedAlertEmail(jobData: ManagedEmailJobData, targetEmail: string): EmailTemplate {
  return renderEnterpriseAlertEmail({
    payload: (jobData.payload ?? {}) as Record<string, unknown>,
    organizationId: jobData.organizationId,
    projectId: jobData.projectId ?? undefined,
    alertKey: jobData.alertKey ?? undefined,
    alertEventId: jobData.alertEventId ?? undefined,
    severity: jobData.severity,
    ruleId: jobData.ruleId ?? undefined,
    deliveryMode: jobData.deliveryMode ?? undefined,
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
  // Structured logging only. Recipient addresses and rendered email bodies are
  // PII/customer content and must never be written to stdout.
  log.debug(
    {
      jobId,
      notificationJobId: jobData.notificationJobId,
      ruleId: jobData.ruleId ?? null,
      severity: jobData.severity,
      organizationId: jobData.organizationId,
    },
    'processing managed email job',
  );

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
      // Log the resolution SOURCE and user id, never the address itself.
      log.debug({ jobId, recipientSource: 'project_owner', recipientUserId: owner.userId }, 'managed email recipient resolved');
    } else {
      const fallback = owners.findActiveVerifiedFallbackRecipient
        ? await owners.findActiveVerifiedFallbackRecipient(jobData.organizationId, jobData.projectId)
        : null;
      if (fallback) {
        targetEmail = fallback.email;
        log.debug({ jobId, recipientSource: 'organization_fallback', recipientUserId: fallback.userId }, 'managed email recipient resolved');
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
        log.warn(
          { jobId, projectId: jobData.projectId, organizationId: jobData.organizationId },
          'Managed email delivery failed: neither project owner nor organization fallback recipient is available',
        );
        return;
      }
    }
  }

  const template = renderManagedAlertEmail(jobData, targetEmail);

  // Deliberately does NOT log the recipient address, the subject, or the
  // rendered body. Those are customer content/PII; dumping them to stdout
  // leaks alert contents into log aggregation. Identifiers are enough to trace
  // a delivery, and the payload is already persisted on the notification job.
  log.debug(
    {
      jobId,
      notificationJobId: jobData.notificationJobId,
      ruleId: jobData.ruleId ?? null,
      alertKey: jobData.alertKey ?? null,
      severity: jobData.severity,
      deliveryMode: jobData.deliveryMode,
      bodyLength: template.text.length,
    },
    'managed email template rendered',
  );

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
      {
        jobId,
        notificationJobId: jobData.notificationJobId,
        organizationId: jobData.organizationId,
        latencyMs: Date.now() - startedAt,
      },
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
    log.error(
      { err, jobId, notificationJobId: jobData.notificationJobId, permanent: isPermanent },
      'Managed email delivery attempt failed',
    );

    if (!isPermanent) {
      throw err;
    }
  }
}

export async function registerConnectorWorkers(
  logger: FastifyBaseLogger,
  runtimeRepository: AlertRuntimeRepository = new AlertRuntimeRepository(logDB.getPrimaryPool()),
  config: ConnectorWorkerConfig = {},
): Promise<{ stop: () => Promise<void> }> {
  const alertDeliveryOnly = config.group === 'alert-delivery';
  const log = logger.child({ component: 'connector-workers', group: config.group ?? 'all' });
  const repository = new ConnectorRepository();
  const notificationEntitlement = new NotificationEntitlementService();
  const owners = new ProjectOwnerRepository(pool);
  const globalGuards = new ConnectorGlobalGuards(pool);
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
  // Canonical V2 transport queues are the ONLY notification transport consumers.
  // The legacy `connector-send-<provider>` family has been removed entirely.
  const transportQueues = connectorTypes.map((t) => connectorTransportQueue(t.type));
  const registeredQueueNames = [...baseQueues, ...transportQueues];
  await Promise.all(registeredQueueNames.map((queue) =>
    safeCreateQueue(queue, config.strictQueueCreation === true),
  ));

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

  for (const queue of transportQueues) {
    const providerType = providerFromTransportQueue(queue);
    const concurrency = getProviderConcurrency(providerType);
    await pgboss.work(
      queue,
      { localConcurrency: concurrency, batchSize: env.CONNECTOR_SEND_BATCH_SIZE } as never,
      (async (arg: unknown) => {
        const jobs = allJobs<ConnectorTransportJob | ManagedEmailJobData>(arg);
        await Promise.all(jobs.map(async (job) => {
          if (isManagedEmailJob(job.data)) {
            await processManagedEmailJob(job.data, job.id, runtimeRepository, notificationEntitlement, owners, log);
            return;
          }
          if (!isConnectorTransportJob(job.data)) {
            log.error({ jobId: job.id }, 'Rejected connector transport job with invalid contract');
            return;
          }
          const channelKind = toChannelKind(job.data.channelKind);
          const capability = await notificationEntitlement.resolve(job.data.organizationId);
          if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess || !capability.isProviderAllowed(channelKind)) {
            await runtimeRepository.recordNotificationDelivery({
              organizationId: job.data.organizationId,
              jobId: job.data.notificationJobId,
              jobStatus: 'failed',
              attemptStatus: 'failed',
              errorCategory: 'DELIVERY_BLOCKED_ENTITLEMENT',
              errorMessage: 'Connector entitlement is unavailable for delivery',
            });
            recordNotificationDelivery('notification.delivery.entitlement_blocked');
            log.warn({ jobId: job.id, channelKind }, 'Connector transport blocked by entitlement');
            return;
          }
          // Defensive tenant verification: the connector is looked up org-scoped
          // AND its stored organization_id is re-compared to the job's claimed
          // tenant. One tenant can never deliver through another's connector.
          const row = await repository.findById(job.data.organizationId, job.data.connectorId);
          if (!row || row.status !== 'active' || row.organization_id !== job.data.organizationId) {
            await runtimeRepository.recordNotificationDelivery({
              organizationId: job.data.organizationId,
              jobId: job.data.notificationJobId,
              jobStatus: 'failed',
              attemptStatus: 'failed',
              errorCategory: 'connector_unavailable',
              errorMessage: 'Connector is missing, inactive, or tenant mismatched',
            });
            log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector transport skipped: inactive or tenant mismatched connector');
            return;
          }

          // Global rate-limit + circuit guard. Previously this guard was only
          // CONSULTED on the legacy provider queue while the canonical V2 queue
          // merely wrote to it, so the circuit state existed but never actually
          // protected the live delivery path. It is now enforced here.
          if (env.CONNECTOR_GLOBAL_LIMITS) {
            const guard = await globalGuards.acquire(job.data.connectorId, {
              limit: env.CONNECTOR_GLOBAL_LIMIT,
              windowSeconds: env.CONNECTOR_GLOBAL_WINDOW_SECONDS,
              failureThreshold: env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD,
              resetSeconds: env.CONNECTOR_CIRCUIT_RESET_SECONDS,
            });
            if (!guard.allowed) {
              // Deferred, not failed: leave the job queued so the delivery-retry
              // sweep replays it once the window/circuit reopens. This keeps
              // retry bounded instead of burning the attempt budget.
              await runtimeRepository.recordNotificationDelivery({
                organizationId: job.data.organizationId,
                jobId: job.data.notificationJobId,
                jobStatus: 'queued',
                attemptStatus: 'failed',
                errorCategory: guard.circuitState === 'open' ? 'circuit_open' : 'rate_limit',
                errorMessage: `Delivery deferred by global guard (circuit=${guard.circuitState})`,
              });
              recordNotificationDelivery('notification.delivery.rate_limited');
              log.warn(
                { jobId: job.id, connectorId: job.data.connectorId, circuitState: guard.circuitState },
                'Connector transport deferred by global guard',
              );
              return;
            }
          }

          const outcome = await dispatcher.dispatch(row, job.data.payload as unknown as NotificationPayload, { routeId: null });
          const succeeded = outcome.status === 'sent';
          const retryable = outcome.result.retryable === true;
          await runtimeRepository.recordNotificationDelivery({
            organizationId: job.data.organizationId,
            jobId: job.data.notificationJobId,
            jobStatus: succeeded ? 'sent' : retryable ? 'queued' : 'failed',
            attemptStatus: succeeded ? 'sent' : 'failed',
            errorCategory: succeeded ? null : outcome.result.failureCategory ?? 'transport',
            errorMessage: succeeded ? null : outcome.result.errorMessage ?? 'Connector delivery deferred or failed',
            latencyMs: outcome.result.latencyMs,
            externalMessageId: outcome.result.externalMessageId ?? null,
            responseStatusCode: outcome.result.statusCode ?? null,
          });
          // Feed the same guard we gate on above, so open/half-open/closed
          // transitions are driven by the live delivery path.
          if (succeeded) await globalGuards.recordSuccess(job.data.connectorId);
          else await globalGuards.recordFailure(job.data.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
        }));
      }) as never,
    );
  }

  await pgboss.work(
    CONNECTOR_JOBS.deliveryRetry,
    {} as never,
    (async () => {
      await monitor.processRetries();
      sweepRateLimiter();
    }) as never,
  );

  if (!alertDeliveryOnly) {
    await pgboss.work(
      CONNECTOR_JOBS.healthCheck,
      {} as never,
      (async () => {
        await monitor.runHealthChecks();
      }) as never,
    );

  await pgboss.work(
    CONNECTOR_JOBS.test,
    { localConcurrency: 3, batchSize: 3 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<ConnectorTestJobData>(arg);
      await Promise.all(jobs.map(async (job) => {
        const row = await repository.findById(job.data.organizationId, job.data.connectorId);
        if (!row) {
          log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector test skipped: connector not found');
          return;
        }
        const capability = await notificationEntitlement.resolve(job.data.organizationId);
        if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess
          || !capability.isProviderAllowed(row.type, true)) {
          recordNotificationDelivery('notification.delivery.entitlement_blocked');
          log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector test blocked by entitlement');
          return;
        }
        const result = await service.runConnectionTest(row, null);
        await repository.insertAuditLog({
          organizationId: job.data.organizationId,
          connectorId: job.data.connectorId,
          action: 'test.completed',
          actorId: null,
          changesSummary: { success: result.success },
        });
      }));
    }) as never,
  );

  await pgboss.work(
    CONNECTOR_JOBS.secretRotation,
    { localConcurrency: 2, batchSize: 2 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<ConnectorSecretRotationJobData>(arg);
      await Promise.all(jobs.map(async (job) => {
        await service.rotateSecret(
          job.data.organizationId,
          workerMeta(job.data.actorUserId ?? null),
          job.data.connectorId,
          { config: job.data.config },
        );
        log.info({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector secret rotation job completed');
      }));
    }) as never,
  );

  await pgboss.work(
    CONNECTOR_JOBS.oauthRefresh,
    { localConcurrency: 3, batchSize: 3 } as never,
    (async (arg: unknown) => {
      const jobs = allJobs<ConnectorOAuthRefreshJobData>(arg);
      await Promise.all(jobs.map(async (job) => {
        const row = await repository.findById(job.data.organizationId, job.data.connectorId);
        if (!row) {
          log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'OAuth refresh skipped: connector not found');
          return;
        }
        const capability = await notificationEntitlement.resolve(job.data.organizationId);
        if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess
          || !capability.isProviderAllowed(row.type, true)) {
          recordNotificationDelivery('notification.delivery.entitlement_blocked');
          log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'OAuth refresh blocked by entitlement');
          return;
        }
        const credential = await repository.getCredential(job.data.organizationId, job.data.connectorId, 'oauth');
        if (!credential) {
          await repository.insertAuditLog({
            organizationId: job.data.organizationId,
            connectorId: job.data.connectorId,
            action: 'oauth.refresh_failed',
            actorId: null,
            changesSummary: { reason: 'missing_oauth_credential' },
          });
          return;
        }
        if (credential.credential_type !== 'oauth') {
          await repository.insertAuditLog({
            organizationId: job.data.organizationId,
            connectorId: job.data.connectorId,
            action: 'oauth.refresh_skipped',
            actorId: null,
            changesSummary: { reason: 'credential_not_active', credentialType: credential.credential_type },
          });
          return;
        }

        const connector = await dispatcher.instantiate(row);
        const currentCredential = decryptConfig(credential.encrypted_value);
        const refreshed = await connector.refreshCredentials(currentCredential);
        if (!refreshed.valid) {
          await repository.insertAuditLog({
            organizationId: job.data.organizationId,
            connectorId: job.data.connectorId,
            action: 'oauth.refresh_failed',
            actorId: null,
            changesSummary: { errors: refreshed.errors },
          });
          return;
        }
        if (refreshed.normalized) {
          const expiresAt = resolveCredentialExpiry(refreshed.normalized, credential.expires_at);
          await repository.upsertCredential({
            organizationId: job.data.organizationId,
            connectorId: job.data.connectorId,
            credentialType: credential.credential_type,
            keyName: credential.key_name,
            encryptedValue: encryptConfig(refreshed.normalized),
            expiresAt,
            actorUserId: null,
          });
        }
        await repository.insertAuditLog({
          organizationId: job.data.organizationId,
          connectorId: job.data.connectorId,
          action: 'oauth.refreshed',
          actorId: null,
        });
      }));
    }) as never,
  );

  await pgboss.work(
    CONNECTOR_JOBS.cleanup,
    {} as never,
    (async () => {
      const expiredOAuthStates = await repository.cleanupExpiredOAuthStates();
      if (expiredOAuthStates > 0) {
        log.info({ expiredOAuthStates }, 'Connector cleanup removed expired OAuth states');
      }
    }) as never,
  );

    await pgboss.work(
      CONNECTOR_JOBS.deadLetterRetry,
      { localConcurrency: 3, batchSize: 3 } as never,
      (async (arg: unknown) => {
      const jobs = allJobs<ConnectorDeliveryRetryJobData>(arg);
      await Promise.all(jobs.map(async (job) => {
        const delivery = await repository.retryDelivery(job.data.organizationId, job.data.deliveryId);
        if (!delivery) {
          log.warn({ jobId: job.id, deliveryId: job.data.deliveryId }, 'Dead-letter retry skipped: delivery not retryable');
          return;
        }
        await repository.insertAuditLog({
          organizationId: job.data.organizationId,
          connectorId: delivery.connector_id,
          action: 'delivery.dead_letter_retry_requested',
          actorId: job.data.actorUserId ?? null,
          changesSummary: { deliveryId: delivery.id },
        });
        await pgboss.send(
          CONNECTOR_JOBS.deliveryRetry,
          { organizationId: job.data.organizationId, deliveryId: delivery.id },
          { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: env.CONNECTOR_RETRY_EXPIRE_SECONDS } as never,
        );
      }));
      }) as never,
    );
  }

  await pgboss.schedule(CONNECTOR_JOBS.deliveryRetry, '* * * * *', {}, { singletonKey: 'connector-delivery-retry' } as never);
  if (!alertDeliveryOnly) {
    await pgboss.schedule(CONNECTOR_JOBS.healthCheck, '*/5 * * * *', {}, { singletonKey: 'connector-health-check' } as never);
    await pgboss.schedule(CONNECTOR_JOBS.cleanup, '0 * * * *', {}, { singletonKey: 'connector-cleanup' } as never);
  }

  log.info(
    { queues: alertDeliveryOnly ? registeredQueueNames : CONNECTOR_JOBS },
    'Connector pg-boss workers registered',
  );

  return {
    stop: async () => {
      clearInterval(circuitProbeTimer);
      await pgboss.unschedule(CONNECTOR_JOBS.deliveryRetry).catch(() => undefined);
      if (!alertDeliveryOnly) {
        await pgboss.unschedule(CONNECTOR_JOBS.healthCheck).catch(() => undefined);
        await pgboss.unschedule(CONNECTOR_JOBS.cleanup).catch(() => undefined);
      }
    },
  };
}
