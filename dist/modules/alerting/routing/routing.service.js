import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
export class RoutingService {
    repo;
    logger;
    constructor(deps) {
        this.repo = deps.repository;
        this.logger = deps.logger;
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    // ── Event ingestion + lifecycle ──────────────────────────────────────────
    // ── Silences ──────────────────────────────────────────────────────────
    // ── Escalation policies ──────────────────────────────────────────────────
    // ── Templates ─────────────────────────────────────────────────────────
    // ── Routing rules ──────────────────────────────────────────────────────
    async createRoutingRule(orgId, meta, body) {
        const rule = await this.repo.createRoutingRule({
            organizationId: orgId, name: body.name, description: body.description ?? null, priority: body.priority,
            conditions: body.conditions, targetConnectorIds: body.targetConnectorIds, targetRouteIds: body.targetRouteIds,
            fallbackConnectorIds: body.fallbackConnectorIds, templateId: body.templateId ?? null, isActive: body.isActive,
        });
        this.audit(orgId, meta, 'routing_rule.created', 'routing_rule', rule.id);
        return rule;
    }
    async listRoutingRules(orgId) {
        return (await this.repo.listRoutingRules(orgId));
    }
    async deleteRoutingRule(orgId, meta, id) {
        await this.repo.deleteRoutingRule(orgId, id);
        this.audit(orgId, meta, 'routing_rule.deleted', 'routing_rule', id);
    }
    async testRouting(orgId, body) {
        const rules = await this.repo.listRoutingRules(orgId);
        const alert = { severity: body.severity, source: body.source, labels: body.labels };
        return resolveRouting(alert, rules);
    }
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
/** Whether an event's labels satisfy a silence's matchers (all must match). */
function matchesSilence(labels, matchers) {
    const entries = Object.entries(matchers ?? {});
    if (entries.length === 0)
        return true; // empty matcher = silence-all for the rule scope
    return entries.every(([k, v]) => String(labels[k] ?? '') === String(v));
}
//# sourceMappingURL=routing.service.js.map