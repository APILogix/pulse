/**
 * Connector pg-boss queue wiring.
 *
 * Required queues:
 *   - connector-send
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
import { CONNECTOR_JOBS } from './job.constants.js';
import type { ConnectorConfigRow, NotificationPayload, RequestMeta } from './types.js';
import { env } from '../../config/env.js';
import { listConnectorTypes } from './registry.js';
import { workerMetrics } from './metrics/worker-metrics.js';
import { EntitlementsRepository } from '../billing/entitlements/repository.js';
import { pool } from '../../config/database.js';
import { ConnectorGlobalGuards } from './runtime-global-guards.js';
import { isConnectorTransportJob, type ConnectorTransportJob } from './delivery/transport.types.js';

interface MinimalJob<T> { id: string; data: T }

function allJobs<T>(arg: unknown): Array<MinimalJob<T>> {
  if (Array.isArray(arg)) return arg as Array<MinimalJob<T>>;
  return arg ? [arg as MinimalJob<T>] : [];
}

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
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

export interface ConnectorOAuthRefreshJobData {
  organizationId: string;
  connectorId: string;
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

function hasEmailDestination(payload: NotificationPayload): boolean {
  const projectChannel = payload.metadata?.projectChannel as Record<string, unknown> | undefined;
  return typeof projectChannel?.destination === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(projectChannel.destination.trim());
}

export async function registerConnectorWorkers(
  logger: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'connector-workers' });
  const repository = new ConnectorRepository();
  const entitlements = new EntitlementsRepository();
  const globalGuards = new ConnectorGlobalGuards(pool);
  const dispatcher = new NotificationDispatcher(repository, logger);
  const service = new ConnectorService({
    repository,
    dispatcher,
    logger,
    emitEvent: async () => undefined,
  });
  const monitor = new ConnectorMonitor(repository, dispatcher, service, logger);

  await Promise.all(Object.values(CONNECTOR_JOBS).map((queue) => safeCreateQueue(queue)));

  const connectorTypes = listConnectorTypes();
  const providerQueues = connectorTypes.map((t) => `${CONNECTOR_JOBS.send}-${t.type}`);
  const transportQueues = connectorTypes.map((t) => `connector.v2.${t.type}`);
  await Promise.all([...providerQueues, ...transportQueues].map((queue) => safeCreateQueue(queue)));

  for (const queue of transportQueues) {
    await pgboss.work(
      queue,
      { localConcurrency: env.CONNECTOR_SEND_CONCURRENCY, batchSize: env.CONNECTOR_SEND_BATCH_SIZE } as never,
      (async (arg: unknown) => {
        const jobs = allJobs<ConnectorTransportJob>(arg);
        await Promise.all(jobs.map(async (job) => {
          if (!isConnectorTransportJob(job.data)) {
            log.error({ jobId: job.id }, 'Rejected connector transport job with invalid contract');
            return;
          }
          const row = await repository.findById(job.data.organizationId, job.data.connectorId);
          if (!row || row.status !== 'active') {
            log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector transport skipped: inactive connector');
            return;
          }
          const outcome = await dispatcher.dispatch(row, job.data.payload as unknown as NotificationPayload, { routeId: null });
          if (outcome.status === 'sent') await globalGuards.recordSuccess(job.data.connectorId);
          else await globalGuards.recordFailure(job.data.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
        }));
      }) as never,
    );
  }

  for (const queue of providerQueues) {
    await pgboss.work(
      queue,
      { 
        localConcurrency: env.CONNECTOR_SEND_CONCURRENCY, 
        batchSize: env.CONNECTOR_SEND_BATCH_SIZE 
      } as never,
      (async (arg: unknown) => {
        const jobs = allJobs<ConnectorSendJobData>(arg);
        if (jobs.length === 0) return;

        const connectorIds = Array.from(new Set(jobs.map(j => j.data.connectorId)));
        const rows = await repository.getByIds(connectorIds);
        const rowMap = new Map(rows.map(r => [r.id, r]));

        await Promise.allSettled(jobs.map(async (job) => {
          workerMetrics.recordJobStarted();
          try {
            let row: ConnectorConfigRow | null | undefined = rowMap.get(job.data.connectorId);
            const payload = payloadWithProjectChannel(job.data);
            if (!row || row.status !== 'active') {
              if (!hasEmailDestination(payload)) {
                log.warn(
                  { jobId: job.id, connectorId: job.data.connectorId, status: row?.status ?? null },
                  'Connector send skipped: connector unavailable and no email fallback destination is present',
                );
                workerMetrics.recordJobFailed(false);
                return;
              }
              row = await repository.findFirstActiveByType(job.data.organizationId, 'email');
              if (!row) {
                const canUseManagedFallback = await entitlements.hasFeature(
                  job.data.organizationId,
                  'alerting.managed_email_fallback',
                );
                if (!canUseManagedFallback) {
                  log.warn(
                    { jobId: job.id, connectorId: job.data.connectorId },
                    'Connector send skipped: managed email fallback is not entitled',
                  );
                  workerMetrics.recordJobFailed(false);
                  return;
                }
                row = await repository.getOrCreateManagedEmailConnector(job.data.organizationId);
              }
              log.warn(
                {
                  jobId: job.id,
                  requestedConnectorId: job.data.connectorId,
                  requestedConnectorStatus: rowMap.get(job.data.connectorId)?.status ?? null,
                  fallbackConnectorId: row.id,
                  managedFallback: row.metadata?.managedBy === 'pulse',
                },
                'Connector unavailable; falling back to email transport',
              );
            }
            if (env.CONNECTOR_GLOBAL_LIMITS) {
              const guard = await globalGuards.acquire(job.data.connectorId, {
                limit: env.CONNECTOR_GLOBAL_LIMIT,
                windowSeconds: env.CONNECTOR_GLOBAL_WINDOW_SECONDS,
                failureThreshold: env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD,
                resetSeconds: env.CONNECTOR_CIRCUIT_RESET_SECONDS,
              });
              if (!guard.allowed) {
                workerMetrics.recordJobFailed(true);
                log.warn({ jobId: job.id, connectorId: job.data.connectorId, circuitState: guard.circuitState }, 'Connector delivery denied by global guard');
                return;
              }
            }

            const outcome = await dispatcher.dispatch(row, payload, { routeId: job.data.routeId ?? null });
            if (outcome.status === 'sent') {
              if (env.CONNECTOR_GLOBAL_LIMITS) await globalGuards.recordSuccess(job.data.connectorId);
              workerMetrics.recordJobCompleted();
            } else {
              if (env.CONNECTOR_GLOBAL_LIMITS) await globalGuards.recordFailure(job.data.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
              workerMetrics.recordJobFailed(outcome.result.retryable ?? false);
            }
          } catch (err) {
            workerMetrics.recordJobFailed(false);
            log.error({ err, jobId: job.id }, 'Connector send job errored unexpectedly');
            // no rethrow — the delivery row + DLQ is the source of truth
          }
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

  await pgboss.schedule(CONNECTOR_JOBS.deliveryRetry, '* * * * *', {}, { singletonKey: 'connector-delivery-retry' } as never);
  await pgboss.schedule(CONNECTOR_JOBS.healthCheck, '*/5 * * * *', {}, { singletonKey: 'connector-health-check' } as never);
  await pgboss.schedule(CONNECTOR_JOBS.cleanup, '0 * * * *', {}, { singletonKey: 'connector-cleanup' } as never);

  log.info({ queues: CONNECTOR_JOBS }, 'Connector pg-boss workers registered');

  return {
    stop: async () => {
      await pgboss.unschedule(CONNECTOR_JOBS.deliveryRetry).catch(() => undefined);
      await pgboss.unschedule(CONNECTOR_JOBS.healthCheck).catch(() => undefined);
      await pgboss.unschedule(CONNECTOR_JOBS.cleanup).catch(() => undefined);
    },
  };
}
