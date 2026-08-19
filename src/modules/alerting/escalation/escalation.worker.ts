import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../../lib/pgboss.js';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import { AlertRuntimeRepository } from '../runtime/alert-runtime.repository.js';
import { NotificationRoutingService } from '../runtime/notification-routing.service.js';
import { hashCanonical } from '../runtime/effective-rule-contract.js';

export interface EscalationSnapshotJob {
  organizationId: string;
  projectId: string;
  ruleId: string;
  alertKey: string;
  alertEventId: string;
  notificationJobId?: string;
  policy: Pick<EffectiveAlertPolicy, 'policyId' | 'version' | 'ruleId' | 'bindingId' | 'effectiveRuleHash' | 'escalationPolicyId' | 'severity' | 'scope' | 'recipientOverrides'>;
  category: string;
  labels: Record<string, unknown>;
  step: number;
  notifyAt: string;
}

export class SnapshotEscalationWorker {
  private readonly runtime: AlertRuntimeRepository;
  private readonly routing: NotificationRoutingService;

  constructor(
    private readonly logger: FastifyBaseLogger,
    logDb?: Pool,
    routing?: NotificationRoutingService,
  ) {
    if (!logDb) throw new Error('SnapshotEscalationWorker requires the Log DB pool');
    this.runtime = new AlertRuntimeRepository(logDb);
    this.routing = routing ?? new NotificationRoutingService({ logger });
  }

  async schedule(job: EscalationSnapshotJob): Promise<void> {
    await pgboss.send('alert.escalate', job, {
      singletonKey: `alert-escalate:${job.alertKey}:${job.step}`,
      startAfter: Math.max(0, Date.parse(job.notifyAt) - Date.now()),
      retryLimit: 3,
      retryDelay: 1,
      retryBackoff: true,
    } as never);
  }

  async run(job: EscalationSnapshotJob): Promise<void> {
    if (Date.parse(job.notifyAt) > Date.now()) return;
    await this.runtime.withTransaction(async (client) => {
      const state = await this.runtime.lockState(client, job.alertKey);
      if (!state || state.organization_id !== job.organizationId || state.project_id !== job.projectId) return;
      if (state.state !== 'firing' || state.next_escalation_at === null || state.next_escalation_at.getTime() > Date.now()) return;

      const routing = await this.routing.resolve({
        organizationId: job.organizationId,
        projectId: job.projectId,
        ruleId: job.ruleId,
        policy: {
          effectiveRuleHash: job.policy.effectiveRuleHash,
          escalationPolicyId: job.policy.escalationPolicyId,
        },
        category: job.category,
        severity: job.policy.severity,
        labels: job.labels,
      });
      if (routing.suppressed || routing.targets.length === 0) {
        await this.runtime.appendHistory({
          organizationId: job.organizationId,
          alertKey: job.alertKey,
          alertEventId: job.alertEventId,
          action: 'escalation_suppressed',
          actorType: 'worker',
          metadata: { reason: routing.suppressionReason ?? 'no_targets', step: job.step, routingDecisionHash: routing.decisionHash },
        }, client);
        await this.runtime.upsertState({
          alertKey: job.alertKey,
          organizationId: job.organizationId,
          projectId: job.projectId,
          latestEventId: job.alertEventId,
          state: 'firing',
          severity: toLogDbSeverity(job.policy.severity),
          seenAt: new Date(),
          escalationPolicyId: job.policy.escalationPolicyId,
          escalationStepNumber: job.step,
          nextEscalationAt: null,
        }, client);
        return;
      }

      const jobs = await this.runtime.insertNotificationJobs(routing.targets.map((target) => {
        const destination = target.deliveryMode === 'EMAIL_ONLY_RESTRICTED'
          ? `${target.recipientUserId ?? 'owner'}:${target.recipientRef ?? 'missing'}`
          : target.channelId ?? target.connectorId ?? target.recipientRef ?? 'default';
        return {
          organizationId: job.organizationId,
          projectId: job.projectId,
          alertEventId: job.alertEventId,
          alertKey: job.alertKey,
          ruleId: job.ruleId,
          bindingId: job.policy.bindingId,
          channelId: target.channelId,
          channelKind: target.channelKind,
          connectorId: target.connectorId,
          routeId: target.routeId,
          recipientUserId: target.recipientUserId,
          recipientRef: target.recipientRef,
          notificationType: 'alert.escalated',
          deliveryMode: target.deliveryMode,
          recipientType: target.recipientType,
          provider: target.provider,
          severity: toLogDbSeverity(job.policy.severity),
          escalationStep: job.step,
          payload: {
            alertEventId: job.alertEventId,
            alertKey: job.alertKey,
            ruleId: job.ruleId,
            organizationId: job.organizationId,
            projectId: job.projectId,
            severity: job.policy.severity,
            category: job.category,
            escalationStep: job.step,
            labels: job.labels,
            policy: job.policy,
            routingDecisionHash: routing.decisionHash,
            recipientRef: target.recipientRef,
            recipientUserId: target.recipientUserId,
          },
          idempotencyKey: hashCanonical({ alertEventId: job.alertEventId, destination, type: 'alert.escalated', step: job.step }),
          routingDecisionHash: routing.decisionHash,
          billable: target.channelKind !== 'in_app',
        };
      }), client);
      await this.runtime.appendLedger(jobs.map((notification) => ({
        organizationId: job.organizationId,
        ruleId: job.ruleId,
        bindingId: job.policy.bindingId,
        alertKey: job.alertKey,
        channelKind: notification.channel_kind,
        recipientUserId: notification.recipient_user_id,
        notificationJobId: notification.id,
      })), client);
      await this.runtime.upsertState({
        alertKey: job.alertKey,
        organizationId: job.organizationId,
        projectId: job.projectId,
        latestEventId: job.alertEventId,
        state: 'firing',
        severity: toLogDbSeverity(job.policy.severity),
        seenAt: new Date(),
        notifiedAt: new Date(),
        escalationPolicyId: job.policy.escalationPolicyId,
        escalationStepNumber: job.step,
        nextEscalationAt: null,
      }, client);
      await this.runtime.appendHistory({
        organizationId: job.organizationId,
        alertKey: job.alertKey,
        alertEventId: job.alertEventId,
        action: 'escalated',
        actorType: 'worker',
        newState: 'firing',
        metadata: { step: job.step, notificationJobs: jobs.length, routingDecisionHash: routing.decisionHash },
      }, client);
      await Promise.all(jobs.map((notification) => pgboss.send(
        'alert.notification-router',
        { notificationJobId: notification.id },
        { retryLimit: 3, retryDelay: 1, retryBackoff: true, expireInSeconds: 300 } as never,
      )));
    });
    this.logger.info({ organizationId: job.organizationId, projectId: job.projectId, alertKey: job.alertKey, step: job.step }, 'Escalation notification jobs created');
  }
}

function toLogDbSeverity(value: string): 'info' | 'warning' | 'error' | 'critical' | 'fatal' {
  if (value === 'fatal') return 'fatal';
  if (value === 'critical') return 'critical';
  if (value === 'error') return 'error';
  if (value === 'warning') return 'warning';
  return 'info';
}

export async function runCorrelationSweep(organizationId: string): Promise<void> {
  await pgboss.send('alert.correlate', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true } as never);
}

export async function runDigestSweep(organizationId: string): Promise<void> {
  await pgboss.send('notification.digest', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true } as never);
}
