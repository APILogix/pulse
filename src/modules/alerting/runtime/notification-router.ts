import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import { env } from '../../../config/env.js';
import { sendEmail } from '../../../shared/email/mailer.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY, type ConnectorJobName } from '../../connectors/job.constants.js';
import {
  AlertRuntimeRepository,
  type NotificationJobDetailRow,
  type NotificationJobStatus,
} from './alert-runtime.repository.js';
import type { ConnectorTransportJob } from '../../connectors/delivery/transport.types.js';
import { ProjectOwnerRepository } from './email-only-restricted-routing.js';

export interface NotificationRouterSummary {
  claimed: number;
  sent: number;
  queued: number;
  failed: number;
  suppressed: number;
}

export class AlertNotificationRouter {
  private readonly repo: AlertRuntimeRepository;
  private readonly log: FastifyBaseLogger;

  constructor(
    logDb: Pool,
    logger: FastifyBaseLogger,
    private readonly owners = new ProjectOwnerRepository(),
  ) {
    this.repo = new AlertRuntimeRepository(logDb);
    this.log = logger.child({ component: 'alert-notification-router' });
  }

  async run(limit = 100): Promise<NotificationRouterSummary> {
    const jobs = await this.repo.withTransaction((client) => this.repo.claimDueNotificationJobs(limit, client));
    const summary: NotificationRouterSummary = {
      claimed: jobs.length,
      sent: 0,
      queued: 0,
      failed: 0,
      suppressed: 0,
    };
    await Promise.allSettled(jobs.map(async (job) => {
      const status = await this.dispatch(job);
      if (status === 'sent') summary.sent += 1;
      else if (status === 'queued') summary.queued += 1;
      else if (status === 'suppressed') summary.suppressed += 1;
      else if (status === 'failed') summary.failed += 1;
    }));
    if (jobs.length > 0) this.log.info({ ...summary }, 'Alert notification router run finished');
    return summary;
  }

  async dispatchById(notificationJobId: string): Promise<NotificationJobStatus> {
    const job = await this.repo.findNotificationJobById(notificationJobId);
    if (!job) return 'failed';
    if (job.status !== 'pending' && job.status !== 'queued') return job.status;
    return this.dispatch(job);
  }

  private async dispatch(job: NotificationJobDetailRow): Promise<NotificationJobStatus> {
    const startedAt = Date.now();
    try {
      if (job.channel_kind === 'in_app') {
        await this.mark(job, 'sent', startedAt);
        return 'sent';
      }

      if (job.channel_kind === 'email' && !job.connector_id && job.recipient_ref) {
        if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED' && (
          job.recipient_type !== 'PROJECT_OWNER' || job.provider !== 'MANAGED_EMAIL'
        )) {
          await this.mark(job, 'suppressed', startedAt, 'invalid_restricted_delivery_contract');
          return 'suppressed';
        }
        if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED') {
          const owner = job.project_id
            ? await this.owners.findActiveVerifiedOwner(job.organization_id, job.project_id)
            : null;
          if (!owner || owner.userId !== job.recipient_user_id || owner.email !== job.recipient_ref) {
            await this.mark(job, 'suppressed', startedAt, 'owner_email_unavailable');
            return 'suppressed';
          }
        }
        await this.sendDirectEmail(job);
        await this.mark(job, 'sent', startedAt);
        return 'sent';
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
        : `${CONNECTOR_JOBS.send}-${job.channel_kind}` as ConnectorJobName;
      const transport: ConnectorTransportJob = {
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
      await pgboss.send(
        queueName,
        env.ALERTING_V2_READ
          ? transport
          : {
              organizationId: job.organization_id,
              connectorId: job.connector_id,
              payload: job.payload,
              routeId: job.route_id,
            },
        {
          priority: CONNECTOR_PRIORITY[toConnectorSeverity(job.severity)] ?? job.priority,
          retryLimit: 0,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
        } as never,
      );
      await this.mark(job, 'queued', startedAt);
      return 'queued';
    } catch (err) {
      await this.mark(job, 'failed', startedAt, err instanceof Error ? err.message : String(err));
      this.log.error({ err, notificationJobId: job.id }, 'Alert notification dispatch failed');
      return 'failed';
    }
  }

  private async sendDirectEmail(job: NotificationJobDetailRow): Promise<void> {
    const payload = job.payload as {
      title?: unknown;
      body?: unknown;
      severity?: unknown;
    };
    const title = typeof payload.title === 'string' ? payload.title : 'Alert notification';
    const body = typeof payload.body === 'string' ? payload.body : title;
    await sendEmail({
      to: job.recipient_ref!,
      subject: `[${String(payload.severity ?? job.severity).toUpperCase()}] ${title}`,
      text: `${title}\n\n${body}`,
      html: `<!doctype html><html><body><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p></body></html>`,
    });
  }

  private async mark(
    job: NotificationJobDetailRow,
    status: NotificationJobStatus,
    startedAt: number,
    errorMessage?: string,
  ): Promise<void> {
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

function toConnectorSeverity(severity: string): 'info' | 'warning' | 'error' | 'critical' {
  if (severity === 'critical' || severity === 'fatal') return 'critical';
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
