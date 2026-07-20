import { logAudit } from '../../../shared/middleware/audit-logger.js';
import { AlertingRepository } from '../repository.js';
import { computeFingerprint } from '../fingerprint.js';
import { evaluateRule } from '../evaluator.js';
import { renderTemplate, extractVariables } from '../template.js';
import { resolveRouting } from '../routing.js';
import { AlertConflictError, AlertNotFoundError, AlertValidationError, } from '../types.js';
import { pgboss } from '../../../lib/pgboss.js';
import { ALERT_JOBS } from '../queue.js';
export class EventsService {
    repo;
    logger;
    constructor(deps) {
        this.repo = deps.repository;
        this.logger = deps.logger;
    }
    // ── Rules ──────────────────────────────────────────────────────────────
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
        const existing = await this.repo.findActiveEventByFingerprint(orgId, fingerprint, dedupWindow, body.projectId ?? null);
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
            projectId: body.projectId ?? null,
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
    // ── Dead-letter queue (admin) ──────────────────────────────────────────
    async listDeadLetters(orgId, query) {
        const { data, total } = await this.repo.listDeadLetters(orgId, query);
        return { data: data.map((d) => this.deadLetterToDto(d)), total };
    }
    /**
     * Manual re-drive of a dead-lettered batch job. Only allowed while the batch
     * is still `processing` — once it has moved on, the orphan sweeper / normal
     * recovery owns the events and re-sending would double-deliver.
     */
    async retryDeadLetter(orgId, meta, id) {
        const deadLetter = await this.repo.findDeadLetterById(orgId, id);
        if (!deadLetter)
            throw new AlertNotFoundError('Dead-letter event');
        if (deadLetter.status === 'discarded')
            throw new AlertConflictError('Dead letter has been discarded');
        if (!deadLetter.batch_id)
            throw new AlertValidationError('Dead letter has no batch to re-drive');
        const loaded = await this.repo.getBatchWithEvents(deadLetter.batch_id, orgId).catch(() => null);
        if (!loaded || loaded.batch.status !== 'processing') {
            throw new AlertConflictError('Batch is no longer processing; automatic recovery owns it now');
        }
        await pgboss.send(ALERT_JOBS.processBatch, { batchId: deadLetter.batch_id, organizationId: orgId }, { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 });
        await this.repo.markDeadLetterRetried(id);
        this.audit(orgId, meta, 'alert_dead_letter.retried', 'alert_dead_letter', id, { batchId: deadLetter.batch_id });
        return { id, batchId: deadLetter.batch_id, retried: true };
    }
    async discardDeadLetter(orgId, meta, id) {
        const deadLetter = await this.repo.findDeadLetterById(orgId, id);
        if (!deadLetter)
            throw new AlertNotFoundError('Dead-letter event');
        if (deadLetter.status === 'discarded')
            return; // idempotent
        await this.repo.discardDeadLetter(orgId, id, meta.actorUserId);
        this.audit(orgId, meta, 'alert_dead_letter.discarded', 'alert_dead_letter', id, { batchId: deadLetter.batch_id });
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
    // ── Escalation policies ──────────────────────────────────────────────────
    // ── Templates ─────────────────────────────────────────────────────────
    // ── Routing rules ──────────────────────────────────────────────────────
    // ── Metrics + stats ──────────────────────────────────────────────────────
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
    eventToDto(e) {
        return {
            id: e.id, organizationId: e.organization_id, ruleId: e.rule_id, projectId: e.project_id,
            status: e.status, severity: e.severity,
            fingerprint: e.fingerprint, source: e.source, sourceId: e.source_id, payload: e.payload,
            duplicateCount: e.duplicate_count, startedAt: e.started_at, endedAt: e.ended_at,
            acknowledgedBy: e.acknowledged_by, acknowledgedAt: e.acknowledged_at,
            resolvedBy: e.resolved_by, resolvedAt: e.resolved_at, resolutionReason: e.resolution_reason,
            labels: e.labels, annotations: e.annotations, createdAt: e.created_at,
        };
    }
    deadLetterToDto(d) {
        return {
            id: d.id, organizationId: d.organization_id, sourceQueue: d.source_queue,
            pgBossJobId: d.pg_boss_job_id, batchId: d.batch_id, eventIds: d.event_ids,
            jobPayload: d.job_payload, errorMessage: d.error_message, status: d.status,
            retryCount: d.retry_count, maxRetries: d.max_retries,
            lastRetryAt: d.last_retry_at, retriedAt: d.retried_at,
            discardedAt: d.discarded_at, discardedBy: d.discarded_by,
            metadata: d.metadata, createdAt: d.created_at, updatedAt: d.updated_at,
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
//# sourceMappingURL=events.service.js.map