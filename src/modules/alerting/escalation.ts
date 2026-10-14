/**
 * Escalation sweep worker.
 *
 * Wires the previously schema-only escalation model into a live execution path:
 *
 *   1. Expired acknowledgments flip back to `firing` so escalation resumes.
 *   2. Firing events whose `next_escalation_at` is due are claimed with
 *      FOR UPDATE SKIP LOCKED (no two workers process the same event).
 *   3. The next active step of the event's policy is executed: canonical V2
 *      transport jobs (connector.v2.<provider>) are enqueued for the step's
 *      connectors, the event advances to that step, and the following step's
 *      wait schedules the next run. Escalation shares the normal notification
 *      transport - it has no separate delivery semantics.
 *   4. When steps run out, the policy's repeat config decides: repeat from
 *      step 1 (bounded by max_repeats; 0 = unlimited) or stop escalating.
 *
 * All escalation transitions write `alert_event_history` rows for audit.
 */
import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository } from './repository.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import type { ConnectorConfigRow, NotificationPayload, NotificationSeverity } from '../connectors/types.js';
import { CONNECTOR_PRIORITY, type ConnectorJobName } from '../connectors/job.constants.js';
import { pgboss } from '../../lib/pgboss.js';
import { logDB } from '../../config/log-database.js';
import {
  AlertRuntimeRepository,
  type LogDbSeverity,
  type NotificationChannelKind,
} from './runtime/alert-runtime.repository.js';
import type { AlertEscalationStepRow, AlertEventRow } from './types.js';
import { env } from '../../config/env.js';
import { isEnabled } from '../feature-flags/service.js';
import { FEATURE_FLAGS } from '../feature-flags/types.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';

type EnqueueConnectorJob = (
  queue: ConnectorJobName,
  data: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

/** Hands a created notification job to the canonical notification router. */
type EnqueueNotificationJob = (notificationJobId: string) => Promise<unknown>;

export interface EscalationSweepResult {
  resumedAcknowledgments: number;
  claimed: number;
  escalated: number;
  repeated: number;
  exhausted: number;
  failed: number;
}

export class AlertEscalationSweep {
  constructor(
    private readonly alertRepo: AlertingRepository,
    private readonly connectorRepo: ConnectorRepository,
    private readonly enqueueConnectorJob: EnqueueConnectorJob,
    private readonly logger: FastifyBaseLogger,
    private readonly entitlement = new NotificationEntitlementService(),
    /** Log DB runtime repository - owns alert_notification_jobs. */
    private readonly runtime: AlertRuntimeRepository = new AlertRuntimeRepository(logDB.getPrimaryPool()),
    private readonly enqueueNotificationJob: EnqueueNotificationJob = (notificationJobId) => pgboss.send(
      'alert.notification-router',
      { notificationJobId },
      { retryLimit: 3, retryDelay: 1, retryBackoff: true, expireInSeconds: 300 } as never,
    ),
  ) {}

  async run(limit: number): Promise<EscalationSweepResult> {
    const log = this.logger.child({ component: 'escalation-sweep' });
    const result: EscalationSweepResult = {
      resumedAcknowledgments: 0, claimed: 0, escalated: 0, repeated: 0, exhausted: 0, failed: 0,
    };

    // 1. Expired acknowledgments resume escalation.
    const resumed = await this.alertRepo.resumeExpiredAcknowledgments(limit);
    result.resumedAcknowledgments = resumed.length;
    await Promise.allSettled(resumed.map((event) => this.alertRepo.insertHistory({
      eventId: event.id, organizationId: event.organization_id,
      action: 'requeued', actorId: null, actorType: 'worker',
      newState: { status: 'firing' },
      metadata: { reason: 'acknowledgment_expired' },
    })));

    // 2. Claim due escalations (SKIP LOCKED inside the repository).
    const claimedEvents = await this.alertRepo.claimEscalationDue(limit);
    const rollout = await Promise.all(claimedEvents.map(async (event) => ({
      event,
      legacyEnabled: await isEnabled(FEATURE_FLAGS.ALERTING_LEGACY_ESCALATION, {
        organizationId: event.organization_id,
        projectId: event.project_id,
      }, true),
    })));
    const events = rollout.filter((entry) => entry.legacyEnabled).map((entry) => entry.event);
    const skippedV2 = rollout.filter((entry) => !entry.legacyEnabled).map((entry) => entry.event);
    await Promise.all(skippedV2.flatMap((event) => [
      this.alertRepo.advanceEscalation(
        event.id,
        event.escalation_step_number,
        event.escalation_repeat_count,
        null,
      ),
      this.alertRepo.insertHistory({
        eventId: event.id,
        organizationId: event.organization_id,
        action: 'escalation_skipped',
        actorId: null,
        actorType: 'worker',
        metadata: { reason: 'v2_cutover' },
      }),
    ]));
    result.claimed = events.length;
    if (events.length === 0) return result;

    // 3. Bulk-load policies, steps, and connectors (no N+1).
    const policyIds = [...new Set(events.map((e) => e.escalation_policy_id).filter((id): id is string => id !== null))];
    const policies = await Promise.all(
      policyIds.map((id) => this.alertRepo.findEscalationPolicy(events.find((e) => e.escalation_policy_id === id)!.organization_id, id)),
    );
    const policyById = new Map(policies.filter((p) => p !== null).map((p) => [p!.id, p!]));

    const steps = await this.alertRepo.listEscalationStepsByPolicyIds(policyIds);
    const stepsByPolicyId = new Map<string, AlertEscalationStepRow[]>();
    for (const step of steps) {
      const list = stepsByPolicyId.get(step.policy_id) ?? [];
      list.push(step);
      stepsByPolicyId.set(step.policy_id, list);
    }

    const connectorIds = [...new Set(steps.flatMap((s) => s.connector_ids))];
    const connectors = await this.connectorRepo.getByIds(connectorIds);
    const connectorById = new Map<string, ConnectorConfigRow>(connectors.map((c) => [c.id, c]));

    // 4. Advance each event concurrently; one failure never aborts the sweep.
    const settled = await Promise.allSettled(events.map(async (event) => {
      const policy = event.escalation_policy_id ? policyById.get(event.escalation_policy_id) : undefined;
      const policySteps = event.escalation_policy_id ? stepsByPolicyId.get(event.escalation_policy_id) ?? [] : [];
      await this.advanceEvent(event, policy ?? null, policySteps, connectorById, result);
    }));

    settled.forEach((res, i) => {
      if (res.status === 'rejected') {
        result.failed += 1;
        log.error({ err: res.reason, eventId: events[i]!.id }, 'Escalation advance failed');
      }
    });

    if (result.claimed > 0 || result.resumedAcknowledgments > 0) {
      log.info({ ...result }, 'Escalation sweep finished');
    }
    return result;
  }

  private async advanceEvent(
    event: AlertEventRow,
    policy: { repeat_interval_minutes: number | null; max_repeats: number; is_active: boolean } | null,
    steps: AlertEscalationStepRow[],
    connectorById: Map<string, ConnectorConfigRow>,
    result: EscalationSweepResult,
  ): Promise<void> {
    const nextStep = steps.find((s) => s.step_number > event.escalation_step_number);

    if (policy && policy.is_active && nextStep) {
      await this.executeStep(event, nextStep, connectorById);

      const followingStep = steps.find((s) => s.step_number > nextStep.step_number);
      let nextAt: Date | null = null;
      let stepNumber = nextStep.step_number;
      let repeatCount = event.escalation_repeat_count;

      if (followingStep) {
        nextAt = new Date(Date.now() + followingStep.wait_minutes * 60_000);
      } else if (this.canRepeat(policy, repeatCount)) {
        // No more steps — wrap around to step 1 after the repeat interval.
        stepNumber = 0;
        repeatCount += 1;
        nextAt = new Date(Date.now() + (policy.repeat_interval_minutes ?? 0) * 60_000);
        result.repeated += 1;
      }

      await this.alertRepo.advanceEscalation(event.id, stepNumber, repeatCount, nextAt);
      await this.alertRepo.insertHistory({
        eventId: event.id, organizationId: event.organization_id,
        action: 'escalation_step', actorId: null, actorType: 'worker',
        newState: { escalationStepNumber: nextStep.step_number, repeatCount },
        metadata: { policyId: event.escalation_policy_id },
      });
      result.escalated += 1;
      return;
    }

    // No further step and no repeat (or policy gone/inactive) — stop escalating.
    if (policy && policy.is_active && steps.length > 0 && this.canRepeat(policy, event.escalation_repeat_count)) {
      const firstStep = steps[0]!;
      await this.executeStep(event, firstStep, connectorById);
      await this.alertRepo.advanceEscalation(
        event.id, 0, event.escalation_repeat_count + 1,
        new Date(Date.now() + (policy.repeat_interval_minutes ?? 0) * 60_000),
      );
      await this.alertRepo.insertHistory({
        eventId: event.id, organizationId: event.organization_id,
        action: 'escalation_step', actorId: null, actorType: 'worker',
        newState: { escalationStepNumber: firstStep.step_number, repeatCount: event.escalation_repeat_count + 1 },
        metadata: { policyId: event.escalation_policy_id, repeat: true },
      });
      result.repeated += 1;
      return;
    }

    await this.alertRepo.advanceEscalation(event.id, event.escalation_step_number, event.escalation_repeat_count, null);
    await this.alertRepo.insertHistory({
      eventId: event.id, organizationId: event.organization_id,
      action: 'escalated', actorId: null, actorType: 'worker',
      newState: { escalationExhausted: true },
      metadata: { policyId: event.escalation_policy_id },
    });
    result.exhausted += 1;
  }

  private canRepeat(
    policy: { repeat_interval_minutes: number | null; max_repeats: number },
    repeatCount: number,
  ): boolean {
    if (policy.repeat_interval_minutes === null || policy.repeat_interval_minutes <= 0) return false;
    return policy.max_repeats === 0 || repeatCount < policy.max_repeats;
  }

  /** Enqueue canonical V2 transport jobs for every connector in the step. */
  private async executeStep(
    event: AlertEventRow,
    step: AlertEscalationStepRow,
    connectorById: Map<string, ConnectorConfigRow>,
  ): Promise<void> {
    const capability = await this.entitlement.resolve(event.organization_id);
    if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess) {
      this.logger.warn({ eventId: event.id }, 'Legacy escalation blocked by connector entitlement');
      return;
    }
    const payload = this.toPayload(event, step);
    await Promise.allSettled(step.connector_ids.map(async (connectorId) => {
      const connector = connectorById.get(connectorId);
      if (!connector) return;

      // Defensive tenant check. `getByIds` is deliberately NOT org-scoped (it is
      // a bulk loader), so escalation must verify ownership itself before
      // dispatching. Without this, a step referencing a foreign connector id
      // would deliver this tenant's alert through another tenant's connector.
      if (connector.organization_id !== event.organization_id) {
        this.logger.error(
          {
            eventId: event.id,
            connectorId,
            expectedOrganizationId: event.organization_id,
            actualOrganizationId: connector.organization_id,
          },
          'Escalation blocked: connector does not belong to the event organization',
        );
        return;
      }
      if (connector.status !== 'active') {
        this.logger.warn(
          { eventId: event.id, connectorId, status: connector.status },
          'Escalation skipped: connector is not active',
        );
        return;
      }

      // Escalation uses the SAME delivery abstraction as a normal notification:
      // create a durable alert_notification_jobs row (which carries the
      // idempotency guarantee) and hand it to the notification router, which
      // owns the canonical connector.v2.<provider> transport. Escalation must NOT
      // enqueue a transport job itself - doing so would bypass the notification
      // job identity/idempotency layer and become a second delivery path.
      const idempotencyKey = createHash('sha256')
        .update(`escalation:${event.id}:${step.step_number}:${event.escalation_repeat_count}:${connectorId}`)
        .digest('hex');

      let inserted: Array<{ id: string }> = [];
      try {
        inserted = await this.runtime.insertNotificationJobs([{
          organizationId: event.organization_id,
          projectId: event.project_id,
          // Legacy escalation operates on alert_events; alert_event_id carries no
          // FK so the legacy event id is a valid correlation value here.
          alertEventId: event.id,
          alertKey: event.fingerprint,
          ruleId: event.rule_id,
          channelKind: connector.type as NotificationChannelKind,
          connectorId,
          routeId: step.route_ids[0] ?? null,
          notificationType: 'alert.escalated',
          severity: event.severity as LogDbSeverity,
          priority: CONNECTOR_PRIORITY[event.severity] ?? 0,
          escalationStep: step.step_number,
          payload: payload as unknown as Record<string, unknown>,
          idempotencyKey,
          billable: true,
        }]);
      } catch (err) {
        this.logger.error(
          { err, eventId: event.id, connectorId, step: step.step_number },
          'Escalation notification job creation failed',
        );
        return;
      }

      if (inserted.length === 0) {
        // Idempotency collision: this exact escalation step was already
        // delivered for this connector. Not an error - do not re-notify.
        this.logger.debug(
          { eventId: event.id, connectorId, step: step.step_number },
          'Escalation notification already created for this step; skipping duplicate',
        );
        return;
      }

      await Promise.all(inserted.map((notification) => this.enqueueNotificationJob(notification.id)));
    }));
  }

  private toPayload(event: AlertEventRow, step: AlertEscalationStepRow): NotificationPayload {
    const p = event.payload as Record<string, unknown>;
    const baseTitle = typeof p.title === 'string' ? p.title : `Alert: ${event.source}`;
    const baseBody = typeof p.message === 'string' ? p.message
      : typeof p.body === 'string' ? p.body
      : `Severity ${event.severity} alert from ${event.source}`;
    const body = step.custom_message_template
      ? `${step.custom_message_template}\n\n${baseBody}`
      : baseBody;
    return {
      notificationType: 'alert',
      severity: event.severity as NotificationSeverity,
      title: `[ESCALATION step ${step.step_number}] ${baseTitle}`,
      body,
      correlationId: event.id,
      dedupKey: `${event.fingerprint}:escalation:${step.step_number}:${event.escalation_repeat_count}`,
      metadata: {
        eventId: event.id,
        ruleId: event.rule_id,
        source: event.source,
        labels: event.labels,
        escalationStep: step.step_number,
        templateId: step.template_id,
      },
    };
  }
}
