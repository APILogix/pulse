import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertNotFoundError, AlertValidationError, } from '../types.js';
export class MetricsService {
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
    // ── Metrics + stats ──────────────────────────────────────────────────────
    async getMetrics(orgId, query) {
        const rows = await this.repo.queryMetrics(orgId, {
            granularity: query.granularity,
            limit: query.limit,
            ...(query.metricType !== undefined ? { metricType: query.metricType } : {}),
            ...(query.ruleId !== undefined ? { ruleId: query.ruleId } : {}),
            ...(query.from !== undefined ? { from: query.from } : {}),
            ...(query.to !== undefined ? { to: query.to } : {}),
        });
        return rows.map((m) => ({
            id: m.id, metricType: m.metric_type, ruleId: m.rule_id, value: Number(m.value),
            bucketStart: m.bucket_start, bucketEnd: m.bucket_end, granularity: m.granularity, labels: m.labels,
        }));
    }
    async getStats(orgId) {
        return this.repo.getRealtimeStats(orgId);
    }
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
//# sourceMappingURL=metrics.service.js.map