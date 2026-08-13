import { pgboss } from '../../../lib/pgboss.js';
import { env } from '../../../config/env.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY } from '../../connectors/job.constants.js';
import { AlertRuntimeRepository, } from './alert-runtime.repository.js';
import { ProjectOwnerRepository } from './email-only-restricted-routing.js';
export class AlertNotificationRouter {
    owners;
    repo;
    log;
    constructor(logDb, logger, owners = new ProjectOwnerRepository()) {
        this.owners = owners;
        this.repo = new AlertRuntimeRepository(logDb);
        this.log = logger.child({ component: 'alert-notification-router' });
    }
    async run(limit = 100) {
        const jobs = await this.repo.withTransaction((client) => this.repo.claimDueNotificationJobs(limit, client));
        const summary = {
            claimed: jobs.length,
            sent: 0,
            queued: 0,
            failed: 0,
            suppressed: 0,
        };
        await Promise.allSettled(jobs.map(async (job) => {
            const status = await this.dispatch(job);
            if (status === 'sent')
                summary.sent += 1;
            else if (status === 'queued')
                summary.queued += 1;
            else if (status === 'suppressed')
                summary.suppressed += 1;
            else if (status === 'failed')
                summary.failed += 1;
        }));
        if (jobs.length > 0)
            this.log.info({ ...summary }, 'Alert notification router run finished');
        return summary;
    }
    async dispatchById(notificationJobId) {
        const job = await this.repo.findNotificationJobById(notificationJobId);
        if (!job)
            return 'failed';
        if (job.status !== 'pending' && job.status !== 'queued')
            return job.status;
        return this.dispatch(job);
    }
    async dispatch(job) {
        const startedAt = Date.now();
        try {
            if (job.channel_kind === 'in_app') {
                await this.mark(job, 'sent', startedAt);
                return 'sent';
            }
            if (job.channel_kind === 'email' && !job.connector_id && job.recipient_ref) {
                if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED' && ((job.recipient_type !== 'PROJECT_OWNER' && job.recipient_type !== 'ORGANIZATION_FALLBACK')
                    || job.provider !== 'MANAGED_EMAIL')) {
                    await this.mark(job, 'suppressed', startedAt, 'invalid_restricted_delivery_contract');
                    return 'suppressed';
                }
                if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED' && job.recipient_type === 'PROJECT_OWNER') {
                    const owner = job.project_id
                        ? await this.owners.findActiveVerifiedOwner(job.organization_id, job.project_id)
                        : null;
                    if (!owner || owner.userId !== job.recipient_user_id || owner.email !== job.recipient_ref) {
                        const fallback = job.project_id && this.owners.findActiveVerifiedFallbackRecipient
                            ? await this.owners.findActiveVerifiedFallbackRecipient(job.organization_id, job.project_id)
                            : null;
                        if (!fallback) {
                            await this.mark(job, 'suppressed', startedAt, 'owner_email_unavailable');
                            return 'suppressed';
                        }
                    }
                }
                const queueName = env.ALERTING_V2_READ
                    ? 'connector.v2.email'
                    : `${CONNECTOR_JOBS.send}-email`;
                const emailTransport = {
                    organizationId: job.organization_id,
                    notificationJobId: job.id,
                    projectId: job.project_id,
                    alertEventId: job.alert_event_id,
                    alertKey: job.alert_key,
                    ruleId: job.rule_id,
                    deliveryMode: job.delivery_mode ?? 'EMAIL_ONLY_RESTRICTED',
                    recipientType: job.recipient_type ?? 'PROJECT_OWNER',
                    recipientUserId: job.recipient_user_id ?? '',
                    recipientEmail: job.recipient_ref,
                    provider: job.provider ?? 'MANAGED_EMAIL',
                    severity: toConnectorSeverity(job.severity),
                    payload: job.payload,
                    idempotencyKey: job.idempotency_key,
                    routingDecisionHash: job.routing_decision_hash,
                };
                await pgboss.send(queueName, emailTransport, {
                    priority: CONNECTOR_PRIORITY[toConnectorSeverity(job.severity)] ?? job.priority,
                    retryLimit: 3,
                    retryDelay: 5,
                    retryBackoff: true,
                    expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
                });
                await this.mark(job, 'queued', startedAt);
                return 'queued';
            }
            if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED') {
                await this.mark(job, 'suppressed', startedAt, 'invalid_restricted_delivery_contract');
                return 'suppressed';
            }
            if (!job.connector_id) {
                await this.mark(job, 'suppressed', startedAt, 'missing_connector');
                return 'suppressed';
            }
            const queueName = env.ALERTING_V2_READ
                ? `connector.v2.${job.channel_kind}`
                : `${CONNECTOR_JOBS.send}-${job.channel_kind}`;
            const transport = {
                organizationId: job.organization_id,
                notificationJobId: job.id,
                connectorId: job.connector_id,
                channelKind: job.channel_kind,
                severity: toConnectorSeverity(job.severity),
                idempotencyKey: job.idempotency_key,
                correlationId: job.alert_key,
                ...(job.notification_type ? { notificationType: job.notification_type } : {}),
                routingDecisionHash: job.routing_decision_hash,
                payload: job.payload,
            };
            await pgboss.send(queueName, env.ALERTING_V2_READ
                ? transport
                : {
                    organizationId: job.organization_id,
                    connectorId: job.connector_id,
                    payload: job.payload,
                    routeId: job.route_id,
                }, {
                priority: CONNECTOR_PRIORITY[toConnectorSeverity(job.severity)] ?? job.priority,
                retryLimit: 0,
                retryDelay: 60,
                retryBackoff: true,
                expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
            });
            await this.mark(job, 'queued', startedAt);
            return 'queued';
        }
        catch (err) {
            await this.mark(job, 'failed', startedAt, err instanceof Error ? err.message : String(err));
            this.log.error({ err, notificationJobId: job.id }, 'Alert notification dispatch failed');
            return 'failed';
        }
    }
    async mark(job, status, startedAt, errorMessage) {
        await this.repo.recordNotificationDelivery({
            organizationId: job.organization_id,
            jobId: job.id,
            jobStatus: status,
            attemptStatus: status,
            errorCategory: errorMessage ? 'router' : null,
            errorMessage: errorMessage ?? null,
            latencyMs: Date.now() - startedAt,
        });
    }
}
function toConnectorSeverity(severity) {
    if (severity === 'critical' || severity === 'fatal')
        return 'critical';
    if (severity === 'error')
        return 'error';
    if (severity === 'warning')
        return 'warning';
    return 'info';
}
//# sourceMappingURL=notification-router.js.map