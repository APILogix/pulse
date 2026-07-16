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
export async function registerConnectorWorkers(logger) {
    const log = logger.child({ component: 'connector-workers' });
    const repository = new ConnectorRepository();
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
    await Promise.all(providerQueues.map((queue) => safeCreateQueue(queue)));
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
            await Promise.all(jobs.map(async (job) => {
                workerMetrics.recordJobStarted();
                try {
                    const row = rowMap.get(job.data.connectorId);
                    if (!row) {
                        log.warn({ jobId: job.id, connectorId: job.data.connectorId }, 'Connector send skipped: connector not found');
                        workerMetrics.recordJobFailed(false);
                        return;
                    }
                    const outcome = await dispatcher.dispatch(row, job.data.payload, { routeId: job.data.routeId ?? null });
                    if (outcome.status === 'sent') {
                        workerMetrics.recordJobCompleted();
                    }
                    else {
                        workerMetrics.recordJobFailed(outcome.result.retryable ?? false);
                    }
                }
                catch (err) {
                    workerMetrics.recordJobFailed(false);
                    throw err;
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
    await pgboss.schedule(CONNECTOR_JOBS.deliveryRetry, '* * * * *', {}, {});
    await pgboss.schedule(CONNECTOR_JOBS.healthCheck, '*/5 * * * *', {}, {});
    await pgboss.schedule(CONNECTOR_JOBS.cleanup, '0 * * * *', {}, {});
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