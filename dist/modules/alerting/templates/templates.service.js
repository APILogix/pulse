import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
export class TemplatesService {
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
    async createTemplate(orgId, meta, body) {
        const template = await this.repo.createTemplate({
            organizationId: orgId, name: body.name, templateType: body.templateType, content: body.content,
            variablesSchema: body.variablesSchema, defaultForSeverity: body.defaultForSeverity ?? null,
            connectorType: body.connectorType ?? null, isDefault: body.isDefault, sampleData: body.sampleData,
        });
        this.audit(orgId, meta, 'alert_template.created', 'alert_template', template.id);
        return template;
    }
    async listTemplates(orgId, limit, offset) {
        const { data, total } = await this.repo.listTemplates(orgId, limit, offset);
        return { data: data, total };
    }
    async deleteTemplate(orgId, meta, id) {
        await this.repo.deleteTemplate(orgId, id);
        this.audit(orgId, meta, 'alert_template.deleted', 'alert_template', id);
    }
    async previewTemplate(orgId, id, sampleData) {
        const template = await this.repo.findTemplate(orgId, id);
        if (!template)
            throw new AlertNotFoundError('Template');
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
//# sourceMappingURL=templates.service.js.map