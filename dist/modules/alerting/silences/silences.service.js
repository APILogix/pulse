import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
export class SilencesService {
    repo;
    logger;
    constructor(deps) {
        this.repo = deps.repository;
        this.logger = deps.logger;
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    // ── Event ingestion + lifecycle ──────────────────────────────────────────
    // ── Silences ──────────────────────────────────────────────────────────
    async createSilence(orgId, meta, body) {
        const silence = await this.repo.createSilence({
            organizationId: orgId, ruleId: body.ruleId ?? null, createdBy: meta.actorUserId,
            comment: body.comment ?? null, startsAt: body.startsAt, endsAt: body.endsAt, matchers: body.matchers,
        });
        this.audit(orgId, meta, 'alert_silence.created', 'alert_silence', silence.id);
        return this.silenceToDto(silence);
    }
    async listSilences(orgId, active, limit, offset) {
        const { data, total } = await this.repo.listSilences(orgId, active, limit, offset);
        return { data: data.map((s) => this.silenceToDto(s)), total };
    }
    async expireSilence(orgId, meta, id) {
        await this.repo.expireSilence(orgId, id);
        this.audit(orgId, meta, 'alert_silence.expired', 'alert_silence', id);
    }
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
    silenceToDto(s) {
        return {
            id: s.id, organizationId: s.organization_id, ruleId: s.rule_id, comment: s.comment,
            startsAt: s.starts_at, endsAt: s.ends_at, matchers: s.matchers, isActive: s.is_active, createdAt: s.created_at,
        };
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
//# sourceMappingURL=silences.service.js.map