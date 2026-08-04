import { pgboss } from '../../../lib/pgboss.js';
import { env } from '../../../config/env.js';
import { sendEmail } from '../../../shared/email/mailer.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY } from '../../connectors/job.constants.js';
import { AlertRuntimeRepository, } from './alert-runtime.repository.js';
export class AlertNotificationRouter {
    repo;
    log;
    constructor(logDb, logger) {
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
                await this.sendDirectEmail(job);
                await this.mark(job, 'sent', startedAt);
                return 'sent';
            }
            if (!job.connector_id) {
                await this.mark(job, 'suppressed', startedAt, 'missing_connector');
                return 'suppressed';
            }
            const queueName = `${CONNECTOR_JOBS.send}-${job.channel_kind}`;
            await pgboss.send(queueName, {
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
    async sendDirectEmail(job) {
        const payload = job.payload;
        const title = typeof payload.title === 'string' ? payload.title : 'Alert notification';
        const body = typeof payload.body === 'string' ? payload.body : title;
        await sendEmail({
            to: job.recipient_ref,
            subject: `[${String(payload.severity ?? job.severity).toUpperCase()}] ${title}`,
            text: `${title}\n\n${body}`,
            html: `<!doctype html><html><body><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p></body></html>`,
        });
    }
    async mark(job, status, startedAt, errorMessage) {
        await this.repo.setNotificationJobStatus(job.id, status);
        await this.repo.appendDeliveryAttempts([{
                organizationId: job.organization_id,
                projectId: job.project_id,
                alertEventId: job.alert_event_id,
                notificationJobId: job.id,
                channelKind: job.channel_kind,
                connectorId: job.connector_id,
                routeId: job.route_id,
                recipientUserId: job.recipient_user_id,
                attemptNumber: 1,
                status,
                errorCategory: errorMessage ? 'router' : null,
                errorMessage: errorMessage ?? null,
                latencyMs: Date.now() - startedAt,
            }]);
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
function escapeHtml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
//# sourceMappingURL=notification-router.js.map