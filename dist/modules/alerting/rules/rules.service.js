import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { getAlertRuleTemplate, listAlertRuleTemplates } from '../evaluator/rule-templates.js';
import { AlertRuntimeRuleCatalog } from '../runtime/rule-catalog.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
import { entitlementsService } from '../../billing/entitlements/service.js';
import { quotaGuard } from '../../billing/entitlements/quota-guard.js';
const FAST_SIGNAL_PREFIXES = [
    'errors.unhandled',
    'errors.fatal',
    'errors.crash',
    'logs.oom',
    'logs.security',
    'cron.failed',
    'requests.auth_failure',
    'deployment.failed',
    'heartbeat.lost',
    'connector.failure',
];
function inferEvaluationCategory(conditions, evaluationIntervalSeconds, presetKey) {
    if (presetKey) {
        if (presetKey.endsWith('_fast'))
            return 'fast';
        return 'analytics';
    }
    const isFastSignal = conditions.length > 0 &&
        conditions.every((c) => {
            const p = c.fieldPath.toLowerCase().trim();
            const lookback = c.lookbackMinutes ?? 0;
            return lookback === 0 && FAST_SIGNAL_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}.`));
        });
    if (isFastSignal && (evaluationIntervalSeconds === undefined || evaluationIntervalSeconds <= 1)) {
        return 'fast';
    }
    return 'analytics';
}
export class RulesService {
    repo;
    logger;
    constructor(deps) {
        this.repo = deps.repository;
        this.logger = deps.logger;
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    async createRule(orgId, meta, body) {
        await entitlementsService.assertFeatureEnabled(orgId, 'alerting.enabled');
        const { total } = await this.repo.listRules(orgId, { limit: 1, offset: 0, sortOrder: 'desc' });
        await quotaGuard.assertCanCreate({
            organizationId: orgId,
            quotaKey: 'quota.alert_rules',
            currentUsage: total,
        });
        if (body.projectId) {
            const projectRulesCount = await this.repo.countProjectRules(orgId, body.projectId);
            await quotaGuard.assertCanCreate({
                organizationId: orgId,
                quotaKey: 'quota.project_alert_rules',
                currentUsage: projectRulesCount,
            });
        }
        const evaluationCategory = inferEvaluationCategory(body.conditions, body.evaluationIntervalSeconds);
        const rule = await this.repo.createRule({
            organizationId: orgId,
            name: body.name,
            description: body.description ?? null,
            severity: body.severity,
            enabled: body.enabled,
            projectId: body.projectId ?? null,
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
            evaluationCategory,
        });
        this.audit(orgId, meta, 'alert_rule.created', 'alert_rule', rule.id, { name: body.name });
        AlertRuntimeRuleCatalog.invalidateGlobal(orgId, undefined, 'rule_created');
        return this.ruleToDto(rule);
    }
    async listRules(orgId, query) {
        const { data, total } = await this.repo.listRules(orgId, query);
        return { data: data.map((r) => this.ruleToDto(r)), total };
    }
    async getRule(orgId, id) {
        const rule = await this.requireRule(orgId, id);
        const [conditions, actions] = await Promise.all([
            this.repo.getRuleConditions(id),
            this.repo.getRuleActions(id),
        ]);
        return { ...this.ruleToDto(rule), conditions, actions };
    }
    async updateRule(orgId, meta, id, body) {
        await this.requireRule(orgId, id);
        const fields = {
            name: body.name, description: body.description, severity: body.severity, enabled: body.enabled,
            projectId: body.projectId,
            evaluationIntervalSeconds: body.evaluationIntervalSeconds, cooldownSeconds: body.cooldownSeconds,
            autoResolveAfterMinutes: body.autoResolveAfterMinutes,
            deduplicationWindowSeconds: body.deduplicationWindowSeconds,
            deduplicationKeyTemplate: body.deduplicationKeyTemplate,
            groupingEnabled: body.groupingEnabled, groupingKeyTemplate: body.groupingKeyTemplate,
            groupingWaitSeconds: body.groupingWaitSeconds,
            labels: body.labels, annotations: body.annotations, metadata: body.metadata,
        };
        const rule = await this.repo.updateRule(orgId, id, fields, body.conditions ? body.conditions.map(toConditionInsert) : null, body.actions ? body.actions.map(toActionInsert) : null, meta.actorUserId);
        this.audit(orgId, meta, 'alert_rule.updated', 'alert_rule', id, { fields: Object.keys(fields).filter((k) => fields[k] !== undefined) });
        AlertRuntimeRuleCatalog.invalidateGlobal(orgId, undefined, 'rule_updated');
        return this.ruleToDto(rule);
    }
    async deleteRule(orgId, meta, id) {
        await this.repo.softDeleteRule(orgId, id);
        this.audit(orgId, meta, 'alert_rule.deleted', 'alert_rule', id);
        AlertRuntimeRuleCatalog.invalidateGlobal(orgId, undefined, 'rule_deleted');
    }
    async setRuleEnabled(orgId, meta, id, enabled) {
        const rule = await this.repo.setRuleEnabled(orgId, id, enabled);
        this.audit(orgId, meta, enabled ? 'alert_rule.enabled' : 'alert_rule.disabled', 'alert_rule', id);
        AlertRuntimeRuleCatalog.invalidateGlobal(orgId, undefined, 'rule_toggled');
        return this.ruleToDto(rule);
    }
    async cloneRule(orgId, meta, id) {
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
            projectId: rule.project_id,
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
        AlertRuntimeRuleCatalog.invalidateGlobal(orgId, undefined, 'rule_cloned');
        return this.ruleToDto(clone);
    }
    listRuleTemplates() {
        return listAlertRuleTemplates().map((template) => ({
            key: template.key,
            name: template.name,
            description: template.description,
            category: template.category,
            rule: template.rule,
        }));
    }
    async createRuleFromTemplate(orgId, meta, templateKey, overrides = {}) {
        const template = getAlertRuleTemplate(templateKey);
        if (!template)
            throw new AlertNotFoundError('Alert rule template');
        const cleanOverrides = omitUndefined(overrides);
        const body = {
            ...template.rule,
            ...cleanOverrides,
            name: cleanOverrides.name ?? template.rule.name,
            severity: cleanOverrides.severity ?? template.rule.severity,
            enabled: cleanOverrides.enabled ?? false,
            evaluationIntervalSeconds: cleanOverrides.evaluationIntervalSeconds ?? template.rule.evaluationIntervalSeconds,
            cooldownSeconds: cleanOverrides.cooldownSeconds ?? template.rule.cooldownSeconds,
            deduplicationWindowSeconds: cleanOverrides.deduplicationWindowSeconds ?? template.rule.deduplicationWindowSeconds,
            groupingEnabled: cleanOverrides.groupingEnabled ?? template.rule.groupingEnabled,
            groupingWaitSeconds: cleanOverrides.groupingWaitSeconds ?? template.rule.groupingWaitSeconds,
            labels: { ...template.rule.labels, ...(cleanOverrides.labels ?? {}), templateKey },
            annotations: { ...template.rule.annotations, ...(cleanOverrides.annotations ?? {}), template_key: templateKey },
            metadata: { ...template.rule.metadata, ...(cleanOverrides.metadata ?? {}), templateKey },
            conditions: cleanOverrides.conditions ?? template.rule.conditions,
            actions: cleanOverrides.actions ?? template.rule.actions,
        };
        return this.createRule(orgId, meta, body);
    }
    async testRule(orgId, id, body) {
        await this.requireRule(orgId, id);
        const conditions = await this.repo.getRuleConditions(id);
        const evaluable = conditions.map((c) => ({
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
    audit(orgId, meta, action, resourceType, resourceId, metadata) {
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
    ruleToDto(r) {
        return {
            id: r.id, organizationId: r.organization_id, name: r.name, description: r.description,
            severity: r.severity, enabled: r.enabled,
            projectId: r.project_id, presetKey: r.preset_key, isDefault: r.is_default,
            lastEvaluatedAt: r.last_evaluated_at,
            evaluationIntervalSeconds: r.evaluation_interval_seconds, cooldownSeconds: r.cooldown_seconds,
            autoResolveAfterMinutes: r.auto_resolve_after_minutes,
            deduplicationWindowSeconds: r.deduplication_window_seconds,
            groupingEnabled: r.grouping_enabled,
            labels: r.labels, annotations: r.annotations, metadata: r.metadata,
            createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
        };
    }
    async requireRule(orgId, id) {
        const rule = await this.repo.findRuleById(orgId, id);
        if (!rule)
            throw new (await import("../types.js")).AlertNotFoundError('Alert rule');
        return rule;
    }
}
function toConditionInsert(c) {
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
function toActionInsert(a) {
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
function omitUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
/** Whether an event's labels satisfy a silence's matchers (all must match). */
function matchesSilence(labels, matchers) {
    const entries = Object.entries(matchers ?? {});
    if (entries.length === 0)
        return true; // empty matcher = silence-all for the rule scope
    return entries.every(([k, v]) => String(labels[k] ?? '') === String(v));
}
//# sourceMappingURL=rules.service.js.map