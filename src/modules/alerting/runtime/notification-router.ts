import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import { env } from '../../../config/env.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY, type ConnectorJobName } from '../../connectors/job.constants.js';
import {
  AlertRuntimeRepository,
  type NotificationJobDetailRow,
  type NotificationJobStatus,
} from './alert-runtime.repository.js';
import type { ConnectorTransportJob, ManagedEmailJobData } from '../../connectors/delivery/transport.types.js';
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
    console.log(`\n[ALERT_ROUTER] 🚀 Dispatching notification job ${job.id} | Channel: ${job.channel_kind} | Mode: ${job.delivery_mode} | Recipient: ${job.recipient_ref ?? job.recipient_user_id ?? 'N/A'} | Severity: ${job.severity} | Rule: ${job.rule_id}`);
    try {
      if (job.channel_kind === 'in_app') {
        await this.mark(job, 'sent', startedAt);
        console.log(`[ALERT_ROUTER] 📱 In-App notification job ${job.id} processed as sent`);
        return 'sent';
      }

      if (job.channel_kind === 'email' && !job.connector_id && job.recipient_ref) {
        if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED' && (
          (job.recipient_type !== 'PROJECT_OWNER' && job.recipient_type !== 'ORGANIZATION_FALLBACK')
          || job.provider !== 'MANAGED_EMAIL'
        )) {
          console.log(`[ALERT_ROUTER] ⚠️ Suppressing email job ${job.id}: invalid restricted delivery contract`);
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
              console.log(`[ALERT_ROUTER] ⚠️ Suppressing email job ${job.id}: owner email unavailable and no fallback found`);
              await this.mark(job, 'suppressed', startedAt, 'owner_email_unavailable');
              return 'suppressed';
            }
          }
        }

        const queueName = env.ALERTING_V2_READ
          ? 'connector.v2.email'
          : `${CONNECTOR_JOBS.send}-email` as ConnectorJobName;

        const emailTransport: ManagedEmailJobData = {
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

        await pgboss.send(
          queueName,
          emailTransport,
          {
            priority: CONNECTOR_PRIORITY[toConnectorSeverity(job.severity)] ?? job.priority,
            retryLimit: 3,
            retryDelay: 5,
            retryBackoff: true,
            expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
          } as never,
        );
        await this.mark(job, 'queued', startedAt);
        console.log(`[ALERT_ROUTER] 📬 Queued managed email job ${job.id} -> Queue: "${queueName}" | Recipient: "${job.recipient_ref}" | RecipientType: ${job.recipient_type}`);
        return 'queued';
      }

      if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED') {
        console.log(`[ALERT_ROUTER] ⚠️ Suppressing job ${job.id}: invalid restricted delivery contract`);
        await this.mark(job, 'suppressed', startedAt, 'invalid_restricted_delivery_contract');
        return 'suppressed';
      }

      if (!job.connector_id) {
        console.log(`[ALERT_ROUTER] ⚠️ Suppressing job ${job.id}: missing connector ID`);
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
      console.log(`[ALERT_ROUTER] 📬 Queued connector job ${job.id} -> Queue: "${queueName}" | Connector: ${job.connector_id} | Channel: ${job.channel_kind}`);
      return 'queued';
    } catch (err) {
      console.error(`[ALERT_ROUTER] ❌ Notification job ${job.id} dispatch failed:`, err);
      await this.mark(job, 'failed', startedAt, err instanceof Error ? err.message : String(err));
      this.log.error({ err, notificationJobId: job.id }, 'Alert notification dispatch failed');
      return 'failed';
    }
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
