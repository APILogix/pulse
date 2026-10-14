import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import { env } from '../../../config/env.js';
import { CONNECTOR_PRIORITY, connectorTransportQueue } from '../../connectors/job.constants.js';
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
    // Structured only, and never log recipient addresses (PII).
    this.log.debug(
      {
        notificationJobId: job.id,
        channelKind: job.channel_kind,
        deliveryMode: job.delivery_mode,
        severity: job.severity,
        ruleId: job.rule_id,
      },
      'dispatching notification job',
    );
    try {
      if (job.channel_kind === 'in_app') {
        await this.mark(job, 'sent', startedAt);
        return 'sent';
      }

      if (job.channel_kind === 'email' && !job.connector_id && job.recipient_ref) {
        if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED' && (
          (job.recipient_type !== 'PROJECT_OWNER' && job.recipient_type !== 'ORGANIZATION_FALLBACK')
          || job.provider !== 'MANAGED_EMAIL'
        )) {
          this.log.warn(
            { notificationJobId: job.id, reason: 'invalid_restricted_delivery_contract' },
            'notification job suppressed',
          );
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
              this.log.warn(
                { notificationJobId: job.id, projectId: job.project_id, reason: 'owner_email_unavailable' },
                'notification job suppressed: no verified owner or fallback recipient',
              );
              await this.mark(job, 'suppressed', startedAt, 'owner_email_unavailable');
              return 'suppressed';
            }
          }
        }

        // Canonical V2 transport is the ONLY delivery path.
        const queueName = connectorTransportQueue('email');

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
        this.log.info(
          {
            notificationJobId: job.id,
            queue: queueName,
            recipientType: job.recipient_type,
            channelKind: 'email',
          },
          'managed email notification queued to canonical transport',
        );
        return 'queued';
      }

      if (job.delivery_mode === 'EMAIL_ONLY_RESTRICTED') {
        this.log.warn(
          { notificationJobId: job.id, reason: 'invalid_restricted_delivery_contract' },
          'notification job suppressed',
        );
        await this.mark(job, 'suppressed', startedAt, 'invalid_restricted_delivery_contract');
        return 'suppressed';
      }

      if (!job.connector_id) {
        this.log.warn(
          { notificationJobId: job.id, channelKind: job.channel_kind, reason: 'missing_connector' },
          'notification job suppressed: no connector bound',
        );
        await this.mark(job, 'suppressed', startedAt, 'missing_connector');
        return 'suppressed';
      }

      // Canonical V2 transport is the ONLY delivery path.
      const queueName = connectorTransportQueue(job.channel_kind);
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
        transport,
        {
          priority: CONNECTOR_PRIORITY[toConnectorSeverity(job.severity)] ?? job.priority,
          retryLimit: 0,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
        } as never,
      );
      await this.mark(job, 'queued', startedAt);
      this.log.info(
        {
          notificationJobId: job.id,
          queue: queueName,
          connectorId: job.connector_id,
          channelKind: job.channel_kind,
        },
        'connector notification queued to canonical transport',
      );
      return 'queued';
    } catch (err) {
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
