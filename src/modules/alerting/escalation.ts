/**
 * Escalation sweep worker.
 *
 * Wires the previously schema-only escalation model into a live execution path:
 *
 *   1. Expired acknowledgments flip back to `firing` so escalation resumes.
 *   2. Firing events whose `next_escalation_at` is due are claimed with
 *      FOR UPDATE SKIP LOCKED (no two workers process the same event).
 *   3. The next active step of the event's policy is executed: connector-send
 *      jobs are enqueued for the step's connectors/routes, the event advances
 *      to that step, and the following step's wait schedules the next run.
 *   4. When steps run out, the policy's repeat config decides: repeat from
 *      step 1 (bounded by max_repeats; 0 = unlimited) or stop escalating.
 *
 * All escalation transitions write `alert_event_history` rows for audit.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AlertingRepository } from './repository.js';
import type { ConnectorRepository } from '../connectors/repository.js';
import type { ConnectorConfigRow, NotificationPayload, NotificationSeverity } from '../connectors/types.js';
import { CONNECTOR_JOBS, CONNECTOR_PRIORITY, type ConnectorJobName } from '../connectors/job.constants.js';
import type { AlertEscalationStepRow, AlertEventRow } from './types.js';
import { env } from '../../config/env.js';

type EnqueueConnectorJob = (
  queue: ConnectorJobName,
  data: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<unknown>;

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
    const events = await this.alertRepo.claimEscalationDue(limit);
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

  /** Enqueue connector-send jobs for every connector in the step. */
  private async executeStep(
    event: AlertEventRow,
    step: AlertEscalationStepRow,
    connectorById: Map<string, ConnectorConfigRow>,
  ): Promise<void> {
    const payload = this.toPayload(event, step);
    await Promise.allSettled(step.connector_ids.map(async (connectorId) => {
      const connector = connectorById.get(connectorId);
      if (!connector) return;
      const queueName = `${CONNECTOR_JOBS.send}-${connector.type}` as ConnectorJobName;
      await this.enqueueConnectorJob(
        queueName,
        {
          organizationId: event.organization_id,
          connectorId,
          payload,
          routeId: step.route_ids[0] ?? null,
        },
        {
          priority: CONNECTOR_PRIORITY[event.severity] ?? 0,
          retryLimit: 0,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
        },
      );
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
