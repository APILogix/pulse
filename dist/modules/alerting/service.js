import { logAudit } from '../../shared/middleware/audit-logger.js';
import { AlertingRepository } from './repository.js';
import { computeFingerprint } from './fingerprint.js';
import { evaluateRule } from './evaluator.js';
import { renderTemplate, extractVariables } from './template.js';
import { resolveRouting } from './routing.js';
import { AlertNotFoundError, AlertValidationError, } from './types.js';
export class AlertingService {
    repo;
    logger;
    constructor(deps) {
        this.repo = deps.repository;
        this.logger = deps.logger;
    }
    // ── Rules ──────────────────────────────────────────────────────────────
    async createRule(orgId, meta, body) {
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
        return this.ruleToDto(rule);
    }
    async deleteRule(orgId, meta, id) {
        await this.repo.softDeleteRule(orgId, id);
        this.audit(orgId, meta, 'alert_rule.deleted', 'alert_rule', id);
    }
    async setRuleEnabled(orgId, meta, id, enabled) {
        const rule = await this.repo.setRuleEnabled(orgId, id, enabled);
        this.audit(orgId, meta, enabled ? 'alert_rule.enabled' : 'alert_rule.disabled', 'alert_rule', id);
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
    async ingestEvent(orgId, body) {
        const fingerprint = body.fingerprint
            ?? computeFingerprint({ ruleId: body.ruleId ?? null, source: body.source, payload: body.payload });
        // Resolve dedup window from the rule when present (default 1h).
        let dedupWindow = 3600;
        if (body.ruleId) {
            const rule = await this.repo.findRuleById(orgId, body.ruleId);
            if (rule)
                dedupWindow = rule.deduplication_window_seconds;
        }
        // Deduplication: fold into an existing active event within the window.
        const existing = await this.repo.findActiveEventByFingerprint(orgId, fingerprint, dedupWindow);
        if (existing) {
            const updated = await this.repo.incrementDuplicate(existing.id);
            return { event: this.eventToDto(updated), deduplicated: true };
        }
        // Silence check: suppress at ingest if an active silence matches.
        const silences = await this.repo.findActiveSilences(orgId, body.ruleId ?? null);
        const silenced = silences.some((s) => matchesSilence(body.labels, s.matchers));
        const autoResolveAt = await this.computeAutoResolveAt(orgId, body.ruleId ?? null);
        const event = await this.repo.insertEvent({
            organizationId: orgId,
            ruleId: body.ruleId ?? null,
            status: silenced ? 'silenced' : 'pending',
            severity: body.severity,
            fingerprint,
            source: body.source,
            sourceId: body.sourceId ?? null,
            payload: body.payload,
            normalizedPayload: null,
            labels: body.labels,
            annotations: body.annotations,
            autoResolveAt,
        });
        await this.repo.insertHistory({
            eventId: event.id, organizationId: orgId,
            action: silenced ? 'silenced' : 'triggered', actorId: null, actorType: 'system',
            newState: { status: event.status, severity: event.severity },
        });
        return { event: this.eventToDto(event), deduplicated: false, silenced };
    }
    async listEvents(orgId, query) {
        const { data, total } = await this.repo.listEvents(orgId, query);
        return { data: data.map((e) => this.eventToDto(e)), total };
    }
    async getEvent(orgId, id) {
        const event = await this.requireEvent(orgId, id);
        const [history, deliveries] = await Promise.all([
            this.repo.getEventHistory(id),
            this.repo.getEventDeliveries(id),
        ]);
        return { ...this.eventToDto(event), history, deliveries };
    }
    async getEventDeliveries(orgId, id) {
        await this.requireEvent(orgId, id);
        return this.repo.getEventDeliveries(id);
    }
    async acknowledgeEvent(orgId, meta, id, body) {
        const expiresAt = body.expiresInMinutes ? new Date(Date.now() + body.expiresInMinutes * 60_000) : null;
        const event = await this.repo.acknowledgeEvent(orgId, id, meta.actorUserId, expiresAt, body.comment ?? null);
        await this.repo.insertHistory({
            eventId: id, organizationId: orgId, action: 'acknowledged', actorId: meta.actorUserId,
            newState: { status: 'acknowledged' }, metadata: { comment: body.comment ?? null },
        });
        this.audit(orgId, meta, 'alert_event.acknowledged', 'alert_event', id);
        return this.eventToDto(event);
    }
    async resolveEvent(orgId, meta, id, body) {
        const event = await this.repo.resolveEvent(orgId, id, meta.actorUserId, body.reason ?? 'manual', false);
        await this.repo.insertHistory({
            eventId: id, organizationId: orgId, action: 'resolved', actorId: meta.actorUserId,
            newState: { status: 'resolved' }, metadata: { comment: body.comment ?? null },
        });
        this.audit(orgId, meta, 'alert_event.resolved', 'alert_event', id);
        return this.eventToDto(event);
    }
    async silenceFromEvent(orgId, meta, id, durationMinutes, comment) {
        const event = await this.requireEvent(orgId, id);
        const silence = await this.repo.createSilence({
            organizationId: orgId,
            ruleId: event.rule_id,
            createdBy: meta.actorUserId,
            comment,
            startsAt: new Date(),
            endsAt: new Date(Date.now() + durationMinutes * 60_000),
            matchers: { fingerprint: event.fingerprint, source: event.source },
        });
        await this.repo.insertHistory({
            eventId: id, organizationId: orgId, action: 'silenced', actorId: meta.actorUserId,
            metadata: { silenceId: silence.id },
        });
        this.audit(orgId, meta, 'alert_silence.created', 'alert_silence', silence.id, { fromEventId: id });
        return this.silenceToDto(silence);
    }
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
    async computeAutoResolveAt(orgId, ruleId) {
        if (!ruleId)
            return null;
        const rule = await this.repo.findRuleById(orgId, ruleId);
        if (rule?.auto_resolve_after_minutes) {
            return new Date(Date.now() + rule.auto_resolve_after_minutes * 60_000);
        }
        return null;
    }
    async requireRule(orgId, id) {
        const rule = await this.repo.findRuleById(orgId, id);
        if (!rule)
            throw new AlertNotFoundError('Alert rule');
        return rule;
    }
    async requireEvent(orgId, id) {
        const event = await this.repo.findEventById(orgId, id);
        if (!event)
            throw new AlertNotFoundError('Alert event');
        return event;
    }
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
            evaluationIntervalSeconds: r.evaluation_interval_seconds, cooldownSeconds: r.cooldown_seconds,
            autoResolveAfterMinutes: r.auto_resolve_after_minutes,
            deduplicationWindowSeconds: r.deduplication_window_seconds,
            groupingEnabled: r.grouping_enabled,
            labels: r.labels, annotations: r.annotations, metadata: r.metadata,
            createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
        };
    }
    eventToDto(e) {
        return {
            id: e.id, organizationId: e.organization_id, ruleId: e.rule_id, status: e.status, severity: e.severity,
            fingerprint: e.fingerprint, source: e.source, sourceId: e.source_id, payload: e.payload,
            duplicateCount: e.duplicate_count, startedAt: e.started_at, endedAt: e.ended_at,
            acknowledgedBy: e.acknowledged_by, acknowledgedAt: e.acknowledged_at,
            resolvedBy: e.resolved_by, resolvedAt: e.resolved_at, resolutionReason: e.resolution_reason,
            labels: e.labels, annotations: e.annotations, createdAt: e.created_at,
        };
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
//# sourceMappingURL=service.js.map