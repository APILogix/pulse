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

export class TemplatesService {
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
  // ── Templates ─────────────────────────────────────────────────────────
  async createTemplate(orgId: string, meta: RequestMeta, body: CreateTemplateBody): Promise<Record<string, unknown>> {
    const template = await this.repo.createTemplate({
      organizationId: orgId, name: body.name, templateType: body.templateType, content: body.content,
      variablesSchema: body.variablesSchema, defaultForSeverity: body.defaultForSeverity ?? null,
      connectorType: body.connectorType ?? null, isDefault: body.isDefault, sampleData: body.sampleData,
    });
    this.audit(orgId, meta, 'alert_template.created', 'alert_template', template.id);
    return template as unknown as Record<string, unknown>;
  }

  async listTemplates(orgId: string, limit: number, offset: number): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const { data, total } = await this.repo.listTemplates(orgId, limit, offset);
    return { data: data as unknown as Record<string, unknown>[], total };
  }

  async deleteTemplate(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.repo.deleteTemplate(orgId, id);
    this.audit(orgId, meta, 'alert_template.deleted', 'alert_template', id);
  }

  async previewTemplate(orgId: string, id: string, sampleData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const template = await this.repo.findTemplate(orgId, id);
    if (!template) throw new AlertNotFoundError('Template');
    const ctx = sampleData ?? template.sample_data ?? {};
    const rendered = renderTemplate(template.content, ctx);
    return {
      output: rendered.output,
      referenced: rendered.referenced,
      missing: rendered.missing,
      declaredVariables: extractVariables(template.content),
    };
  }

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
