import { pgboss } from '../../lib/pgboss.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { sweepRateLimiter } from './runtime.js';
import { decryptConfig, encryptConfig } from './secrets/secret.service.js';
import { CONNECTOR_JOBS } from './job.constants.js';
import { env } from '../../config/env.js';
import { listConnectorTypes } from './registry.js';
import { workerMetrics } from './metrics/worker-metrics.js';
import { EntitlementsRepository } from '../billing/entitlements/repository.js';
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { AlertRuntimeRepository } from '../alerting/runtime/alert-runtime.repository.js';
import { ConnectorGlobalGuards } from './runtime-global-guards.js';
import { isConnectorTransportJob } from './delivery/transport.types.js';
function allJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
function workerMeta(actorUserId = null) {
    return {
        actorUserId,
        actorIp: '127.0.0.1',
        actorUserAgent: 'connector-worker',
        requestId: '00000000-0000-0000-0000-000000000000',
    };
}
function resolveCredentialExpiry(config, fallback) {
    const raw = config.expiresAt;
    if (raw instanceof Date && !Number.isNaN(raw.getTime()))
        return raw;
    if (typeof raw === 'string') {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime()))
            return parsed;
    }
    return fallback;
}
function payloadWithProjectChannel(job) {
    if (!job.projectChannel)
        return job.payload;
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
function hasEmailDestination(payload) {
    const projectChannel = payload.metadata?.projectChannel;
    return typeof projectChannel?.destination === 'string'
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(projectChannel.destination.trim());
}
export async function registerConnectorWorkers(logger, runtimeRepository = new AlertRuntimeRepository(logDB.getPrimaryPool())) {
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
        await pgboss.work(queue, { localConcurrency: env.CONNECTOR_SEND_CONCURRENCY, batchSize: env.CONNECTOR_SEND_BATCH_SIZE }, (async (arg) => {
            const jobs = allJobs(arg);
            await Promise.all(jobs.map(async (job) => {
                if (!isConnectorTransportJob(job.data)) {
                    log.error({ jobId: job.id }, 'Rejected connector transport job with invalid contract');
                    return;
                }
                const row = await repository.findById(job.data.organizationId, job.data.connectorId);
                if (!row || row.status !== 'active') {
                    await runtimeRepository.recordNotificationDelivery({
                        organizationId: job.data.organizationId,
                        jobId: job.data.notificationJobId,
                        jobStatus: 'failed',
                        attemptStatus: 'failed',
                        errorCategory: 'connector_unavailable',
                        errorMessage: 'Connector is missing or inactive',
                    });
                    log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector transport skipped: inactive connector');
                    return;
                }
                const outcome = await dispatcher.dispatch(row, job.data.payload, { routeId: null });
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
                if (succeeded)
                    await globalGuards.recordSuccess(job.data.connectorId);
                else
                    await globalGuards.recordFailure(job.data.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
            }));
        }));
    }
    for (const queue of providerQueues) {
        await pgboss.work(queue, {
            localConcurrency: env.CONNECTOR_SEND_CONCURRENCY,
            batchSize: env.CONNECTOR_SEND_BATCH_SIZE
        }, (async (arg) => {
            const jobs = allJobs(arg);
            if (jobs.length === 0)
                return;
            const connectorIds = Array.from(new Set(jobs.map(j => j.data.connectorId)));
            const rows = await repository.getByIds(connectorIds);
            const rowMap = new Map(rows.map(r => [r.id, r]));
            await Promise.allSettled(jobs.map(async (job) => {
                workerMetrics.recordJobStarted();
                try {
                    let row = rowMap.get(job.data.connectorId);
                    const payload = payloadWithProjectChannel(job.data);
                    if (!row || row.status !== 'active') {
                        if (!hasEmailDestination(payload)) {
                            log.warn({ jobId: job.id, connectorId: job.data.connectorId, status: row?.status ?? null }, 'Connector send skipped: connector unavailable and no email fallback destination is present');
                            workerMetrics.recordJobFailed(false);
                            return;
                        }
                        row = await repository.findFirstActiveByType(job.data.organizationId, 'email');
                        if (!row) {
                            const canUseManagedFallback = await entitlements.hasFeature(job.data.organizationId, 'alerting.managed_email_fallback');
                            if (!canUseManagedFallback) {
                                log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector send skipped: managed email fallback is not entitled');
                                workerMetrics.recordJobFailed(false);
                                return;
                            }
                            row = await repository.getOrCreateManagedEmailConnector(job.data.organizationId);
                        }
                        log.warn({
                            jobId: job.id,
                            requestedConnectorId: job.data.connectorId,
                            requestedConnectorStatus: rowMap.get(job.data.connectorId)?.status ?? null,
                            fallbackConnectorId: row.id,
                            managedFallback: row.metadata?.managedBy === 'pulse',
                        }, 'Connector unavailable; falling back to email transport');
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
                        if (env.CONNECTOR_GLOBAL_LIMITS)
                            await globalGuards.recordSuccess(job.data.connectorId);
                        workerMetrics.recordJobCompleted();
                    }
                    else {
                        if (env.CONNECTOR_GLOBAL_LIMITS)
                            await globalGuards.recordFailure(job.data.connectorId, env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD);
                        workerMetrics.recordJobFailed(outcome.result.retryable ?? false);
                    }
                }
                catch (err) {
                    workerMetrics.recordJobFailed(false);
                    log.error({ err, jobId: job.id }, 'Connector send job errored unexpectedly');
                    // no rethrow — the delivery row + DLQ is the source of truth
                }
            }));
        }));
    }
    await pgboss.work(CONNECTOR_JOBS.deliveryRetry, {}, (async () => {
        await monitor.processRetries();
        sweepRateLimiter();
    }));
    await pgboss.work(CONNECTOR_JOBS.healthCheck, {}, (async () => {
        await monitor.runHealthChecks();
    }));
    await pgboss.work(CONNECTOR_JOBS.test, { localConcurrency: 3, batchSize: 3 }, (async (arg) => {
        const jobs = allJobs(arg);
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
    }));
    await pgboss.work(CONNECTOR_JOBS.secretRotation, { localConcurrency: 2, batchSize: 2 }, (async (arg) => {
        const jobs = allJobs(arg);
        await Promise.all(jobs.map(async (job) => {
            await service.rotateSecret(job.data.organizationId, workerMeta(job.data.actorUserId ?? null), job.data.connectorId, { config: job.data.config });
            log.info({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector secret rotation job completed');
        }));
    }));
    await pgboss.work(CONNECTOR_JOBS.oauthRefresh, { localConcurrency: 3, batchSize: 3 }, (async (arg) => {
        const jobs = allJobs(arg);
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
    }));
    await pgboss.work(CONNECTOR_JOBS.cleanup, {}, (async () => {
        const expiredOAuthStates = await repository.cleanupExpiredOAuthStates();
        if (expiredOAuthStates > 0) {
            log.info({ expiredOAuthStates }, 'Connector cleanup removed expired OAuth states');
        }
    }));
    await pgboss.work(CONNECTOR_JOBS.deadLetterRetry, { localConcurrency: 3, batchSize: 3 }, (async (arg) => {
        const jobs = allJobs(arg);
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
            await pgboss.send(CONNECTOR_JOBS.deliveryRetry, { organizationId: job.data.organizationId, deliveryId: delivery.id }, { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: env.CONNECTOR_RETRY_EXPIRE_SECONDS });
        }));
    }));
    await pgboss.schedule(CONNECTOR_JOBS.deliveryRetry, '* * * * *', {}, { singletonKey: 'connector-delivery-retry' });
    await pgboss.schedule(CONNECTOR_JOBS.healthCheck, '*/5 * * * *', {}, { singletonKey: 'connector-health-check' });
    await pgboss.schedule(CONNECTOR_JOBS.cleanup, '0 * * * *', {}, { singletonKey: 'connector-cleanup' });
    log.info({ queues: CONNECTOR_JOBS }, 'Connector pg-boss workers registered');
    return {
        stop: async () => {
            await pgboss.unschedule(CONNECTOR_JOBS.deliveryRetry).catch(() => undefined);
            await pgboss.unschedule(CONNECTOR_JOBS.healthCheck).catch(() => undefined);
            await pgboss.unschedule(CONNECTOR_JOBS.cleanup).catch(() => undefined);
        },
    };
}
//# sourceMappingURL=queue.js.map