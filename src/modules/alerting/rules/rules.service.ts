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

export class RulesService {
  private readonly repo: AlertingRepository;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: AlertingServiceDeps) {
    this.repo = deps.repository;
    this.logger = deps.logger;
  }

  // ── Rules ──────────────────────────────────────────────────────────────
  async createRule(orgId: string, meta: RequestMeta, body: CreateRuleBody): Promise<Record<string, unknown>> {
    const rule = await this.repo.createRule({
      organizationId: orgId,
      name: body.name,
      description: body.description ?? null,
      severity: body.severity,
      enabled: body.enabled,
      evaluationIntervalSeconds: body.evaluationIntervalSeconds,
      cooldownSeconds: body.cooldownSeconds,
      autoResolveAfterMinutes: body.autoResolveAfterMinutes ?? null,
      deduplicationWindowSeconds: body.deduplicationWindowSeconds,
      deduplicationKeyTemplate: body.deduplicationKeyTemplate ?? null,
      groupingEnabled: body.groupingEnabled,
      groupingKeyTemplate: body.groupingKeyTemplate ?? null,
      groupingWaitSeconds: body.groupingWaitSeconds,
      labels: body.labels,
      annotations: body.annotations,
      metadata: body.metadata,
      createdBy: meta.actorUserId,
      conditions: body.conditions.map(toConditionInsert),
      actions: body.actions.map(toActionInsert),
    });
    this.audit(orgId, meta, 'alert_rule.created', 'alert_rule', rule.id, { name: body.name });
    return this.ruleToDto(rule);
  }

  async listRules(orgId: string, query: ListRulesQuery): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const { data, total } = await this.repo.listRules(orgId, query);
    return { data: data.map((r) => this.ruleToDto(r)), total };
  }

  async getRule(orgId: string, id: string): Promise<Record<string, unknown>> {
    const rule = await this.requireRule(orgId, id);
    const [conditions, actions] = await Promise.all([
      this.repo.getRuleConditions(id),
      this.repo.getRuleActions(id),
    ]);
    return { ...this.ruleToDto(rule), conditions, actions };
  }

  async updateRule(orgId: string, meta: RequestMeta, id: string, body: UpdateRuleBody): Promise<Record<string, unknown>> {
    await this.requireRule(orgId, id);
    const fields: Record<string, unknown> = {
      name: body.name, description: body.description, severity: body.severity, enabled: body.enabled,
      evaluationIntervalSeconds: body.evaluationIntervalSeconds, cooldownSeconds: body.cooldownSeconds,
      autoResolveAfterMinutes: body.autoResolveAfterMinutes,
      deduplicationWindowSeconds: body.deduplicationWindowSeconds,
      deduplicationKeyTemplate: body.deduplicationKeyTemplate,
      groupingEnabled: body.groupingEnabled, groupingKeyTemplate: body.groupingKeyTemplate,
      groupingWaitSeconds: body.groupingWaitSeconds,
      labels: body.labels, annotations: body.annotations, metadata: body.metadata,
    };
    const rule = await this.repo.updateRule(
      orgId, id, fields,
      body.conditions ? body.conditions.map(toConditionInsert) : null,
      body.actions ? body.actions.map(toActionInsert) : null,
      meta.actorUserId,
    );
    this.audit(orgId, meta, 'alert_rule.updated', 'alert_rule', id, { fields: Object.keys(fields).filter((k) => fields[k] !== undefined) });
    return this.ruleToDto(rule);
  }

  async deleteRule(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.repo.softDeleteRule(orgId, id);
    this.audit(orgId, meta, 'alert_rule.deleted', 'alert_rule', id);
  }

  async setRuleEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<Record<string, unknown>> {
    const rule = await this.repo.setRuleEnabled(orgId, id, enabled);
    this.audit(orgId, meta, enabled ? 'alert_rule.enabled' : 'alert_rule.disabled', 'alert_rule', id);
    return this.ruleToDto(rule);
  }

  async cloneRule(orgId: string, meta: RequestMeta, id: string): Promise<Record<string, unknown>> {
    const rule = await this.requireRule(orgId, id);
    const [conditions, actions] = await Promise.all([
      this.repo.getRuleConditions(id),
      this.repo.getRuleActions(id),
    ]);
    const clone = await this.repo.createRule({
      organizationId: orgId,
      name: `${rule.name} (copy)`,
      description: rule.description,
      severity: rule.severity,
      enabled: false,
      evaluationIntervalSeconds: rule.evaluation_interval_seconds,
      cooldownSeconds: rule.cooldown_seconds,
      autoResolveAfterMinutes: rule.auto_resolve_after_minutes,
      deduplicationWindowSeconds: rule.deduplication_window_seconds,
      deduplicationKeyTemplate: rule.deduplication_key_template,
      groupingEnabled: rule.grouping_enabled,
      groupingKeyTemplate: rule.grouping_key_template,
      groupingWaitSeconds: rule.grouping_wait_seconds,
      labels: rule.labels,
      annotations: rule.annotations,
      metadata: rule.metadata,
      createdBy: meta.actorUserId,
      conditions: conditions.map((c) => ({
        conditionType: c.condition_type, conditionGroupId: c.condition_group_id, fieldPath: c.field_path,
        operator: c.operator, thresholdValue: c.threshold_value, lookbackMinutes: c.lookback_minutes,
        aggregateFunction: c.aggregate_function, isRequired: c.is_required, orderIndex: c.order_index,
      })),
      actions: actions.map((a) => ({
        actionType: a.action_type, priority: a.priority, orderIndex: a.order_index, connectorId: a.connector_id,
        routeId: a.route_id, templateId: a.template_id, escalationPolicyId: a.escalation_policy_id,
        throttleDurationSeconds: a.throttle_duration_seconds, maxNotificationsPerHour: a.max_notifications_per_hour,
        actionConditions: a.action_conditions, isActive: a.is_active,
      })),
    });
    this.audit(orgId, meta, 'alert_rule.cloned', 'alert_rule', clone.id, { sourceRuleId: id });
    return this.ruleToDto(clone);
  }

  async testRule(orgId: string, id: string, body: TestRuleBody): Promise<Record<string, unknown>> {
    await this.requireRule(orgId, id);
    const conditions = await this.repo.getRuleConditions(id);
    const evaluable: EvaluableCondition[] = conditions.map((c) => ({
      id: c.id, conditionGroupId: c.condition_group_id, fieldPath: c.field_path,
      operator: c.operator, thresholdValue: c.threshold_value, isRequired: c.is_required,
    }));
    const result = evaluateRule(body.payload, evaluable);
    return { matched: result.matched, conditionResults: result.conditionResults };
  }

  // ── Event ingestion + lifecycle ──────────────────────────────────────────
  // ── Silences ──────────────────────────────────────────────────────────
  // ── Escalation policies ──────────────────────────────────────────────────
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

  private ruleToDto(r: AlertRuleRow): Record<string, unknown> {
    return {
      id: r.id, organizationId: r.organization_id, name: r.name, description: r.description,
      severity: r.severity, enabled: r.enabled,
      evaluationIntervalSeconds: r.evaluation_interval_seconds, cooldownSeconds: r.cooldown_seconds,
      autoResolveAfterMinutes: r.auto_resolve_after_minutes,
      deduplicationWindowSeconds: r.deduplication_window_seconds,
      groupingEnabled: r.grouping_enabled,
      labels: r.labels, annotations: r.annotations, metadata: r.metadata,
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

    private async requireRule(orgId: string, id: string): Promise<import("../types.js").AlertRuleRow> {

                        const rule = await this.repo.findRuleById(orgId, id);
                        if (!rule) throw new (await import("../types.js")).AlertNotFoundError('Alert rule');
                        return rule;
                    
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
