import { CONNECTOR_JOBS, CONNECTOR_PRIORITY } from '../connectors/job.constants.js';
import { env } from '../../config/env.js';
import { isEnabled } from '../feature-flags/service.js';
import { FEATURE_FLAGS } from '../feature-flags/types.js';
import { NotificationEntitlementService } from './runtime/notification-entitlement.service.js';
export class AlertEscalationSweep {
    alertRepo;
    connectorRepo;
    enqueueConnectorJob;
    logger;
    entitlement;
    constructor(alertRepo, connectorRepo, enqueueConnectorJob, logger, entitlement = new NotificationEntitlementService()) {
        this.alertRepo = alertRepo;
        this.connectorRepo = connectorRepo;
        this.enqueueConnectorJob = enqueueConnectorJob;
        this.logger = logger;
        this.entitlement = entitlement;
    }
    async run(limit) {
        const log = this.logger.child({ component: 'escalation-sweep' });
        const result = {
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
            this.alertRepo.advanceEscalation(event.id, event.escalation_step_number, event.escalation_repeat_count, null),
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
        if (events.length === 0)
            return result;
        // 3. Bulk-load policies, steps, and connectors (no N+1).
        const policyIds = [...new Set(events.map((e) => e.escalation_policy_id).filter((id) => id !== null))];
        const policies = await Promise.all(policyIds.map((id) => this.alertRepo.findEscalationPolicy(events.find((e) => e.escalation_policy_id === id).organization_id, id)));
        const policyById = new Map(policies.filter((p) => p !== null).map((p) => [p.id, p]));
        const steps = await this.alertRepo.listEscalationStepsByPolicyIds(policyIds);
        const stepsByPolicyId = new Map();
        for (const step of steps) {
            const list = stepsByPolicyId.get(step.policy_id) ?? [];
            list.push(step);
            stepsByPolicyId.set(step.policy_id, list);
        }
        const connectorIds = [...new Set(steps.flatMap((s) => s.connector_ids))];
        const connectors = await this.connectorRepo.getByIds(connectorIds);
        const connectorById = new Map(connectors.map((c) => [c.id, c]));
        // 4. Advance each event concurrently; one failure never aborts the sweep.
        const settled = await Promise.allSettled(events.map(async (event) => {
            const policy = event.escalation_policy_id ? policyById.get(event.escalation_policy_id) : undefined;
            const policySteps = event.escalation_policy_id ? stepsByPolicyId.get(event.escalation_policy_id) ?? [] : [];
            await this.advanceEvent(event, policy ?? null, policySteps, connectorById, result);
        }));
        settled.forEach((res, i) => {
            if (res.status === 'rejected') {
                result.failed += 1;
                log.error({ err: res.reason, eventId: events[i].id }, 'Escalation advance failed');
            }
        });
        if (result.claimed > 0 || result.resumedAcknowledgments > 0) {
            log.info({ ...result }, 'Escalation sweep finished');
        }
        return result;
    }
    async advanceEvent(event, policy, steps, connectorById, result) {
        const nextStep = steps.find((s) => s.step_number > event.escalation_step_number);
        if (policy && policy.is_active && nextStep) {
            await this.executeStep(event, nextStep, connectorById);
            const followingStep = steps.find((s) => s.step_number > nextStep.step_number);
            let nextAt = null;
            let stepNumber = nextStep.step_number;
            let repeatCount = event.escalation_repeat_count;
            if (followingStep) {
                nextAt = new Date(Date.now() + followingStep.wait_minutes * 60_000);
            }
            else if (this.canRepeat(policy, repeatCount)) {
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
            const firstStep = steps[0];
            await this.executeStep(event, firstStep, connectorById);
            await this.alertRepo.advanceEscalation(event.id, 0, event.escalation_repeat_count + 1, new Date(Date.now() + (policy.repeat_interval_minutes ?? 0) * 60_000));
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
    canRepeat(policy, repeatCount) {
        if (policy.repeat_interval_minutes === null || policy.repeat_interval_minutes <= 0)
            return false;
        return policy.max_repeats === 0 || repeatCount < policy.max_repeats;
    }
    /** Enqueue connector-send jobs for every connector in the step. */
    async executeStep(event, step, connectorById) {
        const capability = await this.entitlement.resolve(event.organization_id);
        if (capability.reason === 'ENTITLEMENT_UNKNOWN' || !capability.connectorAccess) {
            this.logger.warn({ eventId: event.id }, 'Legacy escalation blocked by connector entitlement');
            return;
        }
        const payload = this.toPayload(event, step);
        await Promise.allSettled(step.connector_ids.map(async (connectorId) => {
            const connector = connectorById.get(connectorId);
            if (!connector)
                return;
            const queueName = `${CONNECTOR_JOBS.send}-${connector.type}`;
            await this.enqueueConnectorJob(queueName, {
                organizationId: event.organization_id,
                connectorId,
                payload,
                routeId: step.route_ids[0] ?? null,
            }, {
                priority: CONNECTOR_PRIORITY[event.severity] ?? 0,
                retryLimit: 0,
                retryDelay: 60,
                retryBackoff: true,
                expireInSeconds: env.CONNECTOR_SEND_EXPIRE_SECONDS,
            });
        }));
    }
    toPayload(event, step) {
        const p = event.payload;
        const baseTitle = typeof p.title === 'string' ? p.title : `Alert: ${event.source}`;
        const baseBody = typeof p.message === 'string' ? p.message
            : typeof p.body === 'string' ? p.body
                : `Severity ${event.severity} alert from ${event.source}`;
        const body = step.custom_message_template
            ? `${step.custom_message_template}\n\n${baseBody}`
            : baseBody;
        return {
            notificationType: 'alert',
            severity: event.severity,
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
//# sourceMappingURL=escalation.js.map