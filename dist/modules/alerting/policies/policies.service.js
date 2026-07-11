import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
export class PoliciesService {
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
    async createEscalationPolicy(orgId, meta, body) {
        const policy = await this.repo.createEscalationPolicy({
            organizationId: orgId, name: body.name, description: body.description ?? null,
            repeatIntervalMinutes: body.repeatIntervalMinutes ?? null, maxRepeats: body.maxRepeats, isActive: body.isActive,
        });
        this.audit(orgId, meta, 'escalation_policy.created', 'escalation_policy', policy.id);
        return policy;
    }
    async listEscalationPolicies(orgId, limit, offset) {
        const { data, total } = await this.repo.listEscalationPolicies(orgId, limit, offset);
        return { data: data, total };
    }
    async getEscalationPolicy(orgId, id) {
        const policy = await this.repo.findEscalationPolicy(orgId, id);
        if (!policy)
            throw new AlertNotFoundError('Escalation policy');
        const steps = await this.repo.listEscalationSteps(id);
        return { ...policy, steps };
    }
    async deleteEscalationPolicy(orgId, meta, id) {
        await this.repo.deleteEscalationPolicy(orgId, id);
        this.audit(orgId, meta, 'escalation_policy.deleted', 'escalation_policy', id);
    }
    async upsertEscalationStep(orgId, meta, policyId, body) {
        const policy = await this.repo.findEscalationPolicy(orgId, policyId);
        if (!policy)
            throw new AlertNotFoundError('Escalation policy');
        const step = await this.repo.upsertEscalationStep(policyId, {
            stepNumber: body.stepNumber, waitMinutes: body.waitMinutes, connectorIds: body.connectorIds,
            routeIds: body.routeIds, notifyOnCall: body.notifyOnCall,
            customMessageTemplate: body.customMessageTemplate ?? null, templateId: body.templateId ?? null, isActive: body.isActive,
        });
        this.audit(orgId, meta, 'escalation_step.upserted', 'escalation_policy', policyId, { stepNumber: body.stepNumber });
        return step;
    }
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
//# sourceMappingURL=policies.service.js.map