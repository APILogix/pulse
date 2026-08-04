import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import {
  AlertRuntimeRepository,
  type AlertEventStateRow,
  type AlertEventV2Row,
  type LogDbSeverity,
  type NotificationChannelKind,
  type NotificationJobRow,
} from '../runtime/alert-runtime.repository.js';
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

  constructor(
    logDb: Pool,
    logger: FastifyBaseLogger,
  ) {
    this.runtime = new AlertRuntimeRepository(logDb);
    this.log = logger.child({ component: 'alert-decision-engine' });
  }

  async decide(candidate: AlertDecisionCandidate): Promise<AlertDecisionResult> {
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
        bindingId: candidate.policy.policyId,
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
        notifiedAt: kind === 'fired' ? candidate.observedAt : null,
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
        metadata: { source: candidate.source, policyId: candidate.policy.policyId },
      }, client);

      if (kind === 'recovered') {
        return { alertKey, duplicate: false, suppressed: false, state: nextState, event, notificationJobs: [] } satisfies AlertDecisionResult;
      }

      const channels = candidate.policy.requestedChannels.length > 0
        ? candidate.policy.requestedChannels
        : ['in_app'];
      const jobs = await this.runtime.insertNotificationJobs(channels.map((channel) => ({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId ?? null,
        alertEventId: event.id,
        alertKey,
        channelKind: channel as NotificationChannelKind,
        severity: toSeverity(candidate.policy.severity),
        payload: { policy: candidate.policy, evidence: candidate.evidence ?? {}, annotations: candidate.annotations ?? {} },
        idempotencyKey: hash(`${alertKey}:${channel}:0:0`),
        billable: true,
      })), client);
      await this.runtime.appendLedger(jobs.map((job) => ({
        organizationId: candidate.organizationId,
        ruleId: candidate.policy.ruleId,
        bindingId: candidate.policy.policyId,
        alertKey,
        channelKind: job.channel_kind,
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
