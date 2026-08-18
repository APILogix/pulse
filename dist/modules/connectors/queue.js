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
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { AlertRuntimeRepository } from '../alerting/runtime/alert-runtime.repository.js';
import { NotificationEntitlementService } from '../alerting/runtime/notification-entitlement.service.js';
import { ConnectorGlobalGuards } from './runtime-global-guards.js';
import { isConnectorTransportJob, isManagedEmailJob, } from './delivery/transport.types.js';
import { recordNotificationDelivery } from '../alerting/runtime/notification-metrics.js';
import { sendEmail } from '../../shared/email/mailer.js';
import { ProjectOwnerRepository } from '../alerting/runtime/email-only-restricted-routing.js';
function allJobs(arg) {
    if (Array.isArray(arg))
        return arg;
    return arg ? [arg] : [];
}
async function safeCreateQueue(name, strict = false) {
    const boss = pgboss;
    if (typeof boss.createQueue !== 'function') {
        if (strict)
            throw new Error(`PgBoss queue factory is unavailable for required queue ${name}`);
        return;
    }
    if (strict) {
        await boss.createQueue(name);
        return;
    }
    await Promise.resolve(boss.createQueue(name)).catch(() => undefined);
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
function toChannelKind(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'email' || normalized === 'slack' || normalized === 'discord'
        || normalized === 'teams' || normalized === 'pagerduty' || normalized === 'webhook'
        || normalized === 'sms')
        return normalized;
    throw new Error(`Unsupported connector provider: ${value}`);
}
function getProviderConcurrency(type) {
    const norm = type.trim().toLowerCase();
    if (norm === 'slack')
        return env.CONNECTOR_CONCURRENCY_SLACK;
    if (norm === 'email')
        return env.CONNECTOR_CONCURRENCY_EMAIL;
    if (norm === 'webhook')
        return env.CONNECTOR_CONCURRENCY_WEBHOOK;
    if (norm === 'discord')
        return env.CONNECTOR_CONCURRENCY_DISCORD;
    if (norm === 'teams')
        return env.CONNECTOR_CONCURRENCY_TEAMS;
    if (norm === 'pagerduty')
        return env.CONNECTOR_CONCURRENCY_PAGERDUTY;
    if (norm === 'sms')
        return env.CONNECTOR_CONCURRENCY_SMS;
    return env.CONNECTOR_SEND_CONCURRENCY;
}
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
async function processManagedEmailJob(jobData, jobId, runtimeRepository, notificationEntitlement, owners, log) {
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
        log.warn({ jobId, orgId: jobData.organizationId }, 'Managed email blocked by entitlement');
        return;
    }
    let targetEmail = jobData.recipientEmail;
    if (jobData.deliveryMode === 'EMAIL_ONLY_RESTRICTED' && jobData.projectId) {
        const owner = await owners.findActiveVerifiedOwner(jobData.organizationId, jobData.projectId);
        if (owner) {
            targetEmail = owner.email;
        }
        else {
            const fallback = owners.findActiveVerifiedFallbackRecipient
                ? await owners.findActiveVerifiedFallbackRecipient(jobData.organizationId, jobData.projectId)
                : null;
            if (fallback) {
                targetEmail = fallback.email;
            }
            else {
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
                log.warn({ jobId, projectId: jobData.projectId }, 'Managed email delivery failed: owner email unavailable');
                return;
            }
        }
    }
    const payload = jobData.payload;
    const title = typeof payload.title === 'string' ? payload.title : 'Alert notification';
    const body = typeof payload.body === 'string' ? payload.body : title;
    const subject = `[${String(payload.severity ?? jobData.severity).toUpperCase()}] ${title}`;
    try {
        await sendEmail({
            to: targetEmail,
            subject,
            text: `${title}\n\n${body}`,
            html: `<!doctype html><html><body><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p></body></html>`,
        });
        await runtimeRepository.recordNotificationDelivery({
            organizationId: jobData.organizationId,
            jobId: jobData.notificationJobId,
            jobStatus: 'sent',
            attemptStatus: 'sent',
            latencyMs: Date.now() - startedAt,
        });
        recordNotificationDelivery('notification.delivery.sent');
        log.info({ jobId, targetEmail, notificationJobId: jobData.notificationJobId }, 'Managed email alert delivered successfully');
    }
    catch (err) {
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
        log.error({ err, jobId, targetEmail }, 'Managed email delivery attempt failed');
        if (!isPermanent) {
            throw err;
        }
    }
}
export async function registerConnectorWorkers(logger, runtimeRepository = new AlertRuntimeRepository(logDB.getPrimaryPool()), config = {}) {
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
    const providerQueues = connectorTypes.map((t) => `${CONNECTOR_JOBS.send}-${t.type}`);
    const transportQueues = connectorTypes.map((t) => `connector.v2.${t.type}`);
    const registeredQueueNames = [...baseQueues, ...providerQueues, ...transportQueues];
    await Promise.all(registeredQueueNames.map((queue) => safeCreateQueue(queue, config.strictQueueCreation === true)));
    const circuitProbeTimer = setInterval(async () => {
        try {
            const recovered = await globalGuards.probeOpenCircuits(env.CONNECTOR_CIRCUIT_RESET_SECONDS);
            if (recovered > 0) {
                log.info({ recovered }, 'Circuit breaker probe transitioned open circuits to half_open');
            }
        }
        catch (err) {
            log.warn({ err }, 'Circuit breaker probe sweep failed');
        }
    }, 60_000);
    circuitProbeTimer.unref();
    for (const queue of transportQueues) {
        const providerType = queue.slice('connector.v2.'.length);
        const concurrency = getProviderConcurrency(providerType);
        await pgboss.work(queue, { localConcurrency: concurrency, batchSize: env.CONNECTOR_SEND_BATCH_SIZE }, (async (arg) => {
            const jobs = allJobs(arg);
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
        const providerType = queue.slice(`${CONNECTOR_JOBS.send}-`.length);
        const concurrency = getProviderConcurrency(providerType);
        await pgboss.work(queue, {
            localConcurrency: concurrency,
            batchSize: env.CONNECTOR_SEND_BATCH_SIZE
        }, (async (arg) => {
            const jobs = allJobs(arg);
            if (jobs.length === 0)
                return;
            const connectorIds = Array.from(new Set(jobs.map(j => 'connectorId' in j.data ? j.data.connectorId : null).filter((id) => Boolean(id))));
            const rows = connectorIds.length > 0 ? await repository.getByIds(connectorIds) : [];
            const rowMap = new Map(rows.map(r => [r.id, r]));
            await Promise.allSettled(jobs.map(async (job) => {
                if (isManagedEmailJob(job.data)) {
                    await processManagedEmailJob(job.data, job.id, runtimeRepository, notificationEntitlement, owners, log);
                    return;
                }
                workerMetrics.recordJobStarted();
                try {
                    let row = rowMap.get(job.data.connectorId);
                    const payload = payloadWithProjectChannel(job.data);
                    const capability = await notificationEntitlement.resolve(job.data.organizationId);
                    const requestedType = row?.type ?? queue.slice(`${CONNECTOR_JOBS.send}-`.length);
                    const channelKind = toChannelKind(requestedType);
                    if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess || !capability.isProviderAllowed(channelKind)) {
                        recordNotificationDelivery('notification.delivery.entitlement_blocked');
                        log.warn({ jobId: job.id, channelKind }, 'Connector send blocked by entitlement');
                        workerMetrics.recordJobFailed(false);
                        return;
                    }
                    if (!row || row.status !== 'active') {
                        log.warn({ jobId: job.id, connectorId: job.data.connectorId, status: row?.status ?? null }, 'Connector send blocked: connector unavailable; canonical routing must create any fallback job');
                        workerMetrics.recordJobFailed(false);
                        return;
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
    if (!alertDeliveryOnly) {
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
    }
    await pgboss.schedule(CONNECTOR_JOBS.deliveryRetry, '* * * * *', {}, { singletonKey: 'connector-delivery-retry' });
    if (!alertDeliveryOnly) {
        await pgboss.schedule(CONNECTOR_JOBS.healthCheck, '*/5 * * * *', {}, { singletonKey: 'connector-health-check' });
        await pgboss.schedule(CONNECTOR_JOBS.cleanup, '0 * * * *', {}, { singletonKey: 'connector-cleanup' });
    }
    log.info({ queues: alertDeliveryOnly ? registeredQueueNames : CONNECTOR_JOBS }, 'Connector pg-boss workers registered');
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
//# sourceMappingURL=queue.js.map