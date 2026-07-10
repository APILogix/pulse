/**
 * Alerting business service.
 *
 * Owns alert lifecycle rules and orchestration:
 *   - Rule CRUD (with conditions + actions), enable/disable, clone, test.
 *   - Event ingestion: fingerprint → dedup → silence check → persist as pending
 *     (the background batch worker performs routing + delivery).
 *   - Acknowledge / resolve / silence with audit history.
 *   - Template preview, routing test, metrics + realtime stats.
 *
 * Delivery itself is NOT performed here — events are persisted as `pending` and
 * the pg-boss `alert.form-batches` → `alert.process-batch` pipeline delivers
 * them in concurrent batches (see batch-processor.ts / queue.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository, type RuleActionInsert, type RuleConditionInsert } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule, type EvaluableCondition } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting, type RoutableAlert } from '../routing.js';
import {
  AlertNotFoundError,
  AlertValidationError,
  type AcknowledgeEventBody,
  type AlertEventRow,
  type AlertRuleRow,
  type CreateEscalationPolicyBody,
  type CreateRoutingRuleBody,
  type CreateRuleBody,
  type CreateSilenceBody,
  type CreateTemplateBody,
  type IngestEventBody,
  type ListEventsQuery,
  type ListRulesQuery,
  type MetricsQuery,
  type RequestMeta,
  type ResolveEventBody,
  type TestRoutingBody,
  type TestRuleBody,
  type UpdateRuleBody,
  type UpsertEscalationStepBody,
} from '../types.js';

export interface AlertingServiceDeps {
  repository: AlertingRepository;
  logger: FastifyBaseLogger;
}

export class PoliciesService {
  private readonly repo: AlertingRepository;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: AlertingServiceDeps) {
    this.repo = deps.repository;
    this.logger = deps.logger;
  }

  // ── Rules ──────────────────────────────────────────────────────────────
  // ── Event ingestion + lifecycle ──────────────────────────────────────────
  // ── Silences ──────────────────────────────────────────────────────────
  // ── Escalation policies ──────────────────────────────────────────────────
  async createEscalationPolicy(orgId: string, meta: RequestMeta, body: CreateEscalationPolicyBody): Promise<Record<string, unknown>> {
    const policy = await this.repo.createEscalationPolicy({
      organizationId: orgId, name: body.name, description: body.description ?? null,
      repeatIntervalMinutes: body.repeatIntervalMinutes ?? null, maxRepeats: body.maxRepeats, isActive: body.isActive,
    });
    this.audit(orgId, meta, 'escalation_policy.created', 'escalation_policy', policy.id);
    return policy as unknown as Record<string, unknown>;
  }

  async listEscalationPolicies(orgId: string, limit: number, offset: number): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const { data, total } = await this.repo.listEscalationPolicies(orgId, limit, offset);
    return { data: data as unknown as Record<string, unknown>[], total };
  }

  async getEscalationPolicy(orgId: string, id: string): Promise<Record<string, unknown>> {
    const policy = await this.repo.findEscalationPolicy(orgId, id);
    if (!policy) throw new AlertNotFoundError('Escalation policy');
    const steps = await this.repo.listEscalationSteps(id);
    return { ...(policy as unknown as Record<string, unknown>), steps };
  }

  async deleteEscalationPolicy(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.repo.deleteEscalationPolicy(orgId, id);
    this.audit(orgId, meta, 'escalation_policy.deleted', 'escalation_policy', id);
  }

  async upsertEscalationStep(orgId: string, meta: RequestMeta, policyId: string, body: UpsertEscalationStepBody): Promise<Record<string, unknown>> {
    const policy = await this.repo.findEscalationPolicy(orgId, policyId);
    if (!policy) throw new AlertNotFoundError('Escalation policy');
    const step = await this.repo.upsertEscalationStep(policyId, {
      stepNumber: body.stepNumber, waitMinutes: body.waitMinutes, connectorIds: body.connectorIds,
      routeIds: body.routeIds, notifyOnCall: body.notifyOnCall,
      customMessageTemplate: body.customMessageTemplate ?? null, templateId: body.templateId ?? null, isActive: body.isActive,
    });
    this.audit(orgId, meta, 'escalation_step.upserted', 'escalation_policy', policyId, { stepNumber: body.stepNumber });
    return step as unknown as Record<string, unknown>;
  }

  // ── Templates ─────────────────────────────────────────────────────────
  // ── Routing rules ──────────────────────────────────────────────────────
  // ── Metrics + stats ──────────────────────────────────────────────────────
  // ── Internals ──────────────────────────────────────────────────────────

  private audit(orgId: string, meta: RequestMeta, action: string, resourceType: string, resourceId: string, metadata?: Record<string, unknown>): void {
    logAudit({
      user_id: meta.actorUserId,
      org_id: orgId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      ip_address: meta.actorIp,
      ...(meta.actorUserAgent ? { user_agent: meta.actorUserAgent } : {}),
      request_id: meta.requestId,
      ...(metadata ? { metadata } : {}),
    });
  }
}

function toConditionInsert(c: import('../types.js').RuleConditionInput): RuleConditionInsert {
  return {
    conditionType: c.conditionType,
    conditionGroupId: c.conditionGroupId ?? null,
    fieldPath: c.fieldPath,
    operator: c.operator,
    thresholdValue: c.thresholdValue ?? null,
    lookbackMinutes: c.lookbackMinutes ?? null,
    aggregateFunction: c.aggregateFunction ?? null,
    isRequired: c.isRequired,
    orderIndex: c.orderIndex,
  };
}

function toActionInsert(a: import('../types.js').RuleActionInput): RuleActionInsert {
  return {
    actionType: a.actionType,
    priority: a.priority,
    orderIndex: a.orderIndex,
    connectorId: a.connectorId ?? null,
    routeId: a.routeId ?? null,
    templateId: a.templateId ?? null,
    escalationPolicyId: a.escalationPolicyId ?? null,
    throttleDurationSeconds: a.throttleDurationSeconds,
    maxNotificationsPerHour: a.maxNotificationsPerHour ?? null,
    actionConditions: a.actionConditions,
    isActive: a.isActive,
  };
}

/** Whether an event's labels satisfy a silence's matchers (all must match). */
function matchesSilence(labels: Record<string, unknown>, matchers: Record<string, unknown>): boolean {
  const entries = Object.entries(matchers ?? {});
  if (entries.length === 0) return true; // empty matcher = silence-all for the rule scope
  return entries.every(([k, v]) => String(labels[k] ?? '') === String(v));
}
