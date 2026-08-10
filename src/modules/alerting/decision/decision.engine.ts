import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import {
  AlertRuntimeRepository,
  type AlertEventV2Row,
  type LogDbSeverity,
  type NotificationJobRow,
  type NotificationJobInsert,
} from '../runtime/alert-runtime.repository.js';
import { NotificationRoutingService } from '../runtime/notification-routing.service.js';
import { transitionAlert, type AlertActorType, type AlertLifecycleState, type AlertTransition } from './state-machine.js';

export interface AlertDecisionCandidate {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  dimension?: string | null;
  ruleRevision: number;
  policy: EffectiveAlertPolicy;
  source: string;
  observedAt: Date;
  kind?: 'fired' | 'recovered';
  observedValue?: number | null;
  thresholdValue?: number | null;
  evidence?: Record<string, unknown>;
  labels?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  category?: string;
  conditionFieldPaths?: string[];
}

export interface AlertDecisionResult {
  alertKey: string;
  duplicate: boolean;
  suppressed: boolean;
  state: AlertLifecycleState;
  event: AlertEventV2Row | null;
  notificationJobs: NotificationJobRow[];
}

export function alertFingerprint(candidate: Pick<AlertDecisionCandidate, 'organizationId' | 'projectId' | 'policy' | 'environment' | 'service' | 'endpoint' | 'dimension'>): string {
  return hash([
    candidate.organizationId,
    candidate.projectId ?? 'organization',
    candidate.policy.policyId,
    candidate.environment ?? 'all',
    candidate.service ?? 'all',
    candidate.endpoint ?? 'all',
    candidate.dimension ?? 'all',
  ].join(':'));
}

export class AlertDecisionEngine {
  private readonly runtime: AlertRuntimeRepository;
  private readonly log: FastifyBaseLogger;

  private readonly routing: NotificationRoutingService;

  constructor(
    logDb: Pool,
    logger: FastifyBaseLogger,
    deps: { routing?: NotificationRoutingService } = {},
  ) {
    this.runtime = new AlertRuntimeRepository(logDb);
    this.routing = deps.routing ?? new NotificationRoutingService({ logger });
    this.log = logger.child({ component: 'alert-decision-engine' });
  }

  async decide(candidate: AlertDecisionCandidate): Promise<AlertDecisionResult> {
    if (candidate.projectId && (!candidate.policy.bindingId || !candidate.policy.effectiveRuleHash)) {
      this.log.warn({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        ruleId: candidate.policy.ruleId,
      }, 'Alert decision rejected: missing effective project rule identity');
      return {
        alertKey: alertFingerprint(candidate),
        duplicate: false,
        suppressed: true,
        state: 'suppressed',
        event: null,
        notificationJobs: [],
      };
    }
    const kind = candidate.kind ?? 'fired';
    const alertKey = alertFingerprint(candidate);
    const idempotencyKey = hash(`${alertKey}:${kind}:${candidate.observedAt.toISOString()}`);

    const result = await this.runtime.withTransaction(async (client) => {
      const previous = await this.runtime.lockState(client, alertKey);
      const event = await this.runtime.appendEvent({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId ?? null,
        environment: candidate.environment ?? null,
        service: candidate.service ?? null,
        endpoint: candidate.endpoint ?? null,
        ruleId: candidate.policy.ruleId,
        bindingId: candidate.policy.bindingId,
        ruleRevision: candidate.ruleRevision,
        kind,
        severity: toSeverity(candidate.policy.severity),
        priority: severityPriority(candidate.policy.severity),
        fingerprint: alertKey,
        dedupKey: `${alertKey}:${kind}`,
        correlationKey: alertKey,
        source: candidate.source,
        engine: 'fast',
        idempotencyKey,
        observedValue: candidate.observedValue ?? null,
        thresholdValue: candidate.thresholdValue ?? null,
        evidence: candidate.evidence ?? {},
        labels: candidate.labels ?? {},
        annotations: candidate.annotations ?? {},
        policySnapshot: candidate.policy as unknown as Record<string, unknown>,
        occurredAt: candidate.observedAt,
      }, client);

      if (!event) {
        const duplicateState = await this.runtime.incrementDuplicate(alertKey, candidate.observedAt, client);
        return {
          alertKey,
          duplicate: true,
          suppressed: false,
          state: (duplicateState?.state ?? previous?.state ?? 'firing') as AlertLifecycleState,
          event: null,
          notificationJobs: [],
        } satisfies AlertDecisionResult;
      }

      const routingDecision = kind === 'fired'
        ? await this.routing.resolve({
          organizationId: candidate.organizationId,
          projectId: candidate.projectId ?? null,
          ruleId: candidate.policy.ruleId,
          policy: {
            effectiveRuleHash: candidate.policy.effectiveRuleHash,
            escalationPolicyId: candidate.policy.escalationPolicyId,
          },
          category: candidate.category ?? 'all',
          severity: toRoutingSeverity(candidate.policy.severity),
          labels: candidate.labels ?? {},
        })
        : null;
      const hasNotificationTargets = routingDecision !== null
        && !routingDecision.suppressed
        && routingDecision.targets.length > 0;
      const previousState = (previous?.state ?? 'healthy') as AlertLifecycleState;
      const transition: AlertTransition = kind === 'recovered' ? 'recover' : 'trigger';
      const nextState = transitionAlert(previousState, transition, 'worker');
      const state = await this.runtime.upsertState({
        alertKey,
        organizationId: candidate.organizationId,
        projectId: candidate.projectId ?? null,
        latestEventId: event.id,
        state: nextState,
        severity: toSeverity(candidate.policy.severity),
        seenAt: candidate.observedAt,
        notifiedAt: hasNotificationTargets ? candidate.observedAt : null,
        autoResolveAt: candidate.policy.autoResolveAfterMinutes
          ? new Date(candidate.observedAt.getTime() + candidate.policy.autoResolveAfterMinutes * 60_000)
          : null,
        escalationPolicyId: candidate.policy.escalationPolicyId,
      }, client);
      await this.runtime.appendHistory({
        organizationId: candidate.organizationId,
        alertKey,
        alertEventId: event.id,
        action: kind === 'fired' ? 'triggered' : 'resolved',
        actorType: 'worker',
        previousState,
        newState: nextState,
        metadata: {
          source: candidate.source,
          policyId: candidate.policy.policyId,
          effectiveRuleHash: candidate.policy.effectiveRuleHash,
          routingDecisionHash: routingDecision?.decisionHash ?? null,
          notificationSuppressed: routingDecision?.suppressed ?? false,
          suppressionReason: routingDecision?.suppressionReason ?? null,
        },
      }, client);

      if (kind === 'recovered' || !routingDecision || routingDecision.suppressed) {
        return {
          alertKey,
          duplicate: false,
          suppressed: routingDecision?.suppressed ?? false,
          state: nextState,
          event,
          notificationJobs: [],
        } satisfies AlertDecisionResult;
      }

      const jobs = await this.runtime.insertNotificationJobs(
        routingDecision.targets.map((target) => {
          const destinationIdentity = target.deliveryMode === 'EMAIL_ONLY_RESTRICTED'
            ? `${target.recipientUserId ?? 'owner'}:${target.recipientRef ?? 'missing'}`
            : target.channelId ?? target.connectorId ?? target.recipientRef ?? 'default';
          const payload = {
            policy: candidate.policy,
            evidence: candidate.evidence ?? {},
            annotations: candidate.annotations ?? {},
            routingDecisionHash: routingDecision.decisionHash,
          };
          return {
            organizationId: candidate.organizationId,
            projectId: candidate.projectId ?? null,
            alertEventId: event.id,
            alertKey,
            ruleId: candidate.policy.ruleId,
            bindingId: candidate.policy.bindingId,
            channelId: target.channelId,
            channelKind: target.channelKind,
            connectorId: target.connectorId,
            routeId: target.routeId,
            recipientUserId: target.recipientUserId,
            recipientRef: target.recipientRef,
            notificationType: 'alert',
            deliveryMode: target.deliveryMode,
            recipientType: target.recipientType,
            provider: target.provider,
            severity: toSeverity(candidate.policy.severity),
            payload,
            idempotencyKey: hash(`${event.id}:${destinationIdentity}:alert:0:0`),
            routingDecisionHash: routingDecision.decisionHash,
            billable: target.channelKind !== 'in_app',
          } satisfies NotificationJobInsert;
        }),
        client,
      );
      await this.runtime.appendLedger(jobs.map((job) => ({
        organizationId: candidate.organizationId,
        ruleId: candidate.policy.ruleId,
        bindingId: candidate.policy.bindingId,
        alertKey,
        channelKind: job.channel_kind,
        recipientUserId: job.recipient_user_id,
        notificationJobId: job.id,
      })), client);
      return { alertKey, duplicate: false, suppressed: false, state: state.state, event, notificationJobs: jobs } satisfies AlertDecisionResult;
    });

    this.log.info({ alertKey, duplicate: result.duplicate, jobs: result.notificationJobs.length }, 'Alert decision persisted');
    return result;
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toSeverity(value: string): LogDbSeverity {
  if (value === 'debug' || value === 'info' || value === 'warning' || value === 'error' || value === 'critical' || value === 'fatal') return value;
  return 'error';
}

function severityPriority(value: string): number {
  return { debug: 0, info: 10, warning: 30, error: 70, critical: 90, fatal: 100 }[value] ?? 70;
}

function toRoutingSeverity(value: string): 'info' | 'warning' | 'error' | 'critical' {
  if (value === 'critical' || value === 'fatal') return 'critical';
  if (value === 'error') return 'error';
  if (value === 'warning') return 'warning';
  return 'info';
}
