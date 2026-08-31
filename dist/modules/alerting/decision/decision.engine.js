import { createHash } from 'node:crypto';
import { AlertRuntimeRepository, } from '../runtime/alert-runtime.repository.js';
import { NotificationRoutingService } from '../runtime/notification-routing.service.js';
import { transitionAlert } from './state-machine.js';
import { normalizeRoute } from '../runtime/route-normalizer.js';
import { alertIdentityHash } from '../runtime/alert-fingerprint.js';
import { buildAlertNotificationPayload } from '../runtime/alert-notification-formatter.js';
import { IncidentsRepository } from '../incidents/incidents.repository.js';
import { recordIncidentOpened, recordIncidentPersistFailed, recordIncidentResolved, recordIncidentReused, } from '../runtime/alert-runtime-metrics.js';
/**
 * Derive the canonical alert identity for a decision candidate.
 *
 * This is a THIN ADAPTER over `alertIdentityHash` - the one canonical identity
 * function (see runtime/alert-fingerprint.ts). It exists only for callers that
 * do not already hold a computed fingerprint. Callers that DO have one (the
 * runtime engines, which computed it via `computeAlertFingerprint` for the
 * cooldown gate) must pass `candidate.alertKey` so that the cooldown key and the
 * durable dedup key are guaranteed to be byte-identical.
 *
 * The dimension key is normalized the same way here as in the grouping path:
 * when the engine supplies a pre-joined `dimension` we use it verbatim;
 * otherwise we build a sorted `k=v` key from service/endpoint so an ungrouped
 * alert still lands on a stable identity.
 */
export function alertFingerprint(candidate) {
    return alertIdentityHash({
        organizationId: candidate.organizationId,
        projectId: candidate.projectId ?? 'organization',
        environment: candidate.environment ?? 'all',
        ruleId: candidate.policy.ruleId,
        policyId: candidate.policy.policyId,
        dimensionKey: decisionDimensionKey(candidate),
    });
}
/**
 * Build a stable, sorted dimension key from a decision candidate.
 *
 * Every scope component contributes to identity: two different services (or
 * endpoints) breaching the same rule are genuinely different alerts and must not
 * collapse onto one dedup key. The engine-supplied grouping `dimension` is an
 * ADDITIONAL discriminator, not a replacement for scope.
 */
function decisionDimensionKey(candidate) {
    const pairs = [];
    if (candidate.service)
        pairs.push(`service=${String(candidate.service).trim().toLowerCase().slice(0, 64)}`);
    if (candidate.endpoint)
        pairs.push(`route=${normalizeRoute(candidate.endpoint)}`);
    if (candidate.dimension)
        pairs.push(`dim=${String(candidate.dimension)}`);
    return pairs.length > 0 ? pairs.sort((a, b) => a.localeCompare(b)).join('|') : 'global';
}
export class AlertDecisionEngine {
    runtime;
    log;
    routing;
    incidents;
    constructor(logDb, logger, deps = {}) {
        this.runtime = new AlertRuntimeRepository(logDb);
        this.routing = deps.routing ?? new NotificationRoutingService({ logger });
        this.incidents = deps.incidents;
        this.log = logger.child({ component: 'alert-decision-engine' });
    }
    /**
     * Persist the durable incident for a decision.
     *
     * INGESTION SAFETY: this runs inside `decide()`, which executes only in the
     * alert worker process (driven by the telemetry outbox relay / evaluation
     * crons). It is never on the ingestion request path, and it adds no per-event
     * work - one statement per *matched* evaluation, deduplicated onto an existing
     * active incident by the partial unique index.
     *
     * FAILURE POLICY: incident persistence is deliberately non-fatal. Notifying an
     * on-call engineer matters more than recording the incident row, so a primary-db
     * outage degrades bookkeeping rather than suppressing the page. The failure is
     * counted and logged, never swallowed silently.
     */
    async persistIncident(candidate, alertKey, kind) {
        if (!this.incidents)
            return { incidentId: null, occurrenceCount: null, startedAt: null };
        const tier = typeof candidate.labels?.tier === 'string' ? candidate.labels.tier : 'unknown';
        try {
            if (kind === 'recovered') {
                const resolved = await this.incidents.resolveByFingerprint(candidate.organizationId, alertKey, candidate.observedAt, 'condition_recovered');
                if (resolved) {
                    recordIncidentResolved('recovery');
                    await this.incidents
                        .appendEvent({
                        incidentId: resolved.id,
                        organizationId: resolved.organization_id,
                        projectId: resolved.project_id,
                        kind: 'incident_resolved',
                        actorType: 'worker',
                        detail: { reason: 'condition_recovered', verifiedRecovery: true },
                        occurredAt: candidate.observedAt,
                    })
                        .catch((err) => {
                        this.log.warn({ err, incidentId: resolved.id }, 'incident lifecycle event append failed; resolution already committed');
                    });
                }
                return {
                    incidentId: resolved?.id ?? null,
                    occurrenceCount: resolved?.occurrence_count ?? null,
                    startedAt: resolved?.started_at ?? null,
                };
            }
            const incidents = this.incidents;
            const { incident, created } = await incidents.openOrReuse({
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                environment: candidate.environment ?? null,
                ruleId: candidate.policy.ruleId,
                ruleRevision: candidate.ruleRevision,
                bindingId: candidate.policy.bindingId,
                fingerprint: alertKey,
                dimensionKey: candidate.dimension ?? 'global',
                severity: toIncidentSeverity(candidate.policy.severity),
                title: incidentTitle(candidate),
                service: candidate.service ?? null,
                route: candidate.endpoint ?? null,
                observedValue: candidate.observedValue ?? null,
                thresholdValue: candidate.thresholdValue ?? null,
                observedAt: candidate.observedAt,
                labels: (candidate.labels ?? {}),
            });
            if (created)
                recordIncidentOpened(tier);
            else
                recordIncidentReused(tier);
            // Durable lifecycle timeline. Best-effort: the incident row is already
            // committed, so a failed audit append must not fail the decision.
            await incidents
                .appendEvent({
                incidentId: incident.id,
                organizationId: incident.organization_id,
                projectId: incident.project_id,
                kind: created ? 'incident_opened' : 'condition_still_breaching',
                actorType: 'worker',
                detail: {
                    tier,
                    observedValue: candidate.observedValue ?? null,
                    thresholdValue: candidate.thresholdValue ?? null,
                    occurrenceCount: incident.occurrence_count,
                },
                occurredAt: candidate.observedAt,
            })
                .catch((err) => {
                this.log.warn({ err, incidentId: incident.id }, 'incident lifecycle event append failed; incident row already committed');
            });
            return { incidentId: incident.id, occurrenceCount: incident.occurrence_count, startedAt: incident.started_at };
        }
        catch (err) {
            recordIncidentPersistFailed(kind === 'recovered' ? 'resolve' : 'open');
            this.log.error({ err, alertKey, organizationId: candidate.organizationId, kind }, 'incident persistence failed; alert delivery continues');
            return { incidentId: null, occurrenceCount: null, startedAt: null };
        }
    }
    async decide(candidate) {
        if (candidate.projectId && (!candidate.policy.bindingId || !candidate.policy.effectiveRuleHash)) {
            this.log.warn({
                organizationId: candidate.organizationId,
                projectId: candidate.projectId,
                ruleId: candidate.policy.ruleId,
            }, 'Alert decision rejected: missing effective project rule identity');
            return {
                alertKey: alertFingerprint(candidate),
                duplicate: false,
                suppressed: true,
                state: 'suppressed',
                event: null,
                notificationJobs: [],
            };
        }
        const kind = candidate.kind ?? 'fired';
        // Prefer the caller's canonical key; fall back to deriving it identically.
        const alertKey = candidate.alertKey ?? alertFingerprint(candidate);
        const idempotencyKey = hash(`${alertKey}:${kind}:${candidate.observedAt.toISOString()}`);
        // Durable incident lifecycle in the PRIMARY db. Done before the Log DB
        // transaction so the incident id can be attached to alert_event_state, and
        // kept outside that transaction because the two live in different databases -
        // there is no distributed transaction, and incident persistence must never be
        // able to roll back or block notification creation.
        const { incidentId, occurrenceCount, startedAt } = await this.persistIncident(candidate, alertKey, kind);
        this.log.debug({
            ruleId: candidate.policy.ruleId,
            organizationId: candidate.organizationId,
            projectId: candidate.projectId ?? null,
            kind,
            severity: candidate.policy.severity,
            alertKey,
        }, 'processing alert decision');
        const result = await this.runtime.withTransaction(async (client) => {
            const previous = await this.runtime.lockState(client, alertKey);
            const event = await this.runtime.appendEvent({
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                environment: candidate.environment ?? null,
                service: candidate.service ?? null,
                endpoint: candidate.endpoint ?? null,
                ruleId: candidate.policy.ruleId,
                bindingId: candidate.policy.bindingId,
                ruleRevision: candidate.ruleRevision,
                kind,
                severity: toSeverity(candidate.policy.severity),
                priority: severityPriority(candidate.policy.severity),
                fingerprint: alertKey,
                dedupKey: `${alertKey}:${kind}`,
                correlationKey: alertKey,
                source: candidate.source,
                engine: 'fast',
                idempotencyKey,
                observedValue: candidate.observedValue ?? null,
                thresholdValue: candidate.thresholdValue ?? null,
                evidence: candidate.evidence ?? {},
                labels: candidate.labels ?? {},
                annotations: candidate.annotations ?? {},
                policySnapshot: candidate.policy,
                occurredAt: candidate.observedAt,
            }, client);
            if (!event) {
                const duplicateState = await this.runtime.incrementDuplicate(alertKey, candidate.observedAt, client);
                this.log.debug({ alertKey, kind, ruleId: candidate.policy.ruleId }, 'duplicate alert collapsed by idempotency key');
                return {
                    alertKey,
                    duplicate: true,
                    suppressed: false,
                    state: (duplicateState?.state ?? previous?.state ?? 'firing'),
                    event: null,
                    notificationJobs: [],
                };
            }
            const routingDecision = kind === 'fired'
                ? await this.routing.resolve({
                    organizationId: candidate.organizationId,
                    projectId: candidate.projectId ?? null,
                    ruleId: candidate.policy.ruleId,
                    policy: {
                        effectiveRuleHash: candidate.policy.effectiveRuleHash,
                        escalationPolicyId: candidate.policy.escalationPolicyId,
                    },
                    category: candidate.category ?? 'all',
                    severity: toRoutingSeverity(candidate.policy.severity),
                    labels: candidate.labels ?? {},
                })
                : null;
            const hasNotificationTargets = routingDecision !== null
                && !routingDecision.suppressed
                && routingDecision.targets.length > 0;
            const previousState = (previous?.state ?? 'healthy');
            const transition = kind === 'recovered' ? 'recover' : 'trigger';
            const nextState = transitionAlert(previousState, transition, 'worker');
            this.log.debug({ alertKey, previousState, nextState, transition, actor: 'worker' }, 'alert state transition');
            if (routingDecision) {
                if (routingDecision.suppressed) {
                    this.log.info({
                        alertKey,
                        organizationId: candidate.organizationId,
                        reason: routingDecision.suppressionReason,
                        deliveryMode: routingDecision.deliveryMode,
                    }, 'notification routing suppressed');
                }
                else {
                    // Do NOT log recipient addresses - that is PII. Counts and channel
                    // kinds are sufficient to debug routing; the notification job row
                    // carries the recipient for audit.
                    this.log.debug({
                        alertKey,
                        organizationId: candidate.organizationId,
                        deliveryMode: routingDecision.deliveryMode,
                        targetCount: routingDecision.targets.length,
                        channelKinds: [...new Set(routingDecision.targets.map((t) => t.channelKind))],
                    }, 'notification targets resolved');
                }
            }
            const state = await this.runtime.upsertState({
                alertKey,
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                latestEventId: event.id,
                state: nextState,
                severity: toSeverity(candidate.policy.severity),
                seenAt: candidate.observedAt,
                notifiedAt: hasNotificationTargets ? candidate.observedAt : null,
                autoResolveAt: candidate.policy.autoResolveAfterMinutes
                    ? new Date(candidate.observedAt.getTime() + candidate.policy.autoResolveAfterMinutes * 60_000)
                    : null,
                escalationPolicyId: candidate.policy.escalationPolicyId,
                // Cross-database reference by identifier only (never an FK): links the
                // Log DB runtime state to the authoritative primary-db incident.
                ...(incidentId ? { incidentId } : {}),
            }, client);
            await this.runtime.appendHistory({
                organizationId: candidate.organizationId,
                alertKey,
                alertEventId: event.id,
                action: kind === 'fired' ? 'triggered' : 'resolved',
                actorType: 'worker',
                previousState,
                newState: nextState,
                metadata: {
                    source: candidate.source,
                    policyId: candidate.policy.policyId,
                    effectiveRuleHash: candidate.policy.effectiveRuleHash,
                    routingDecisionHash: routingDecision?.decisionHash ?? null,
                    notificationSuppressed: routingDecision?.suppressed ?? false,
                    suppressionReason: routingDecision?.suppressionReason ?? null,
                },
            }, client);
            // Publish the alerting -> automation domain event in the SAME transaction
            // as the alert commit above (see appendDomainOutbox's doc comment for why
            // this is an outbox row, not a direct cross-database write). Published for
            // both 'fired' and 'recovered' kinds — including suppressed/no-routing
            // fired events, because automation rule matching is independent of whether
            // a human notification was routed. Only genuinely duplicate/collapsed
            // decisions (handled by the `if (!event)` branch earlier) produce no event.
            await this.runtime.appendDomainOutbox({
                organizationId: candidate.organizationId,
                projectId: candidate.projectId ?? null,
                environment: candidate.environment ?? null,
                alertKey,
                alertEventId: event.id,
                eventType: kind === 'fired' ? 'alert.event.created' : 'alert.event.resolved',
                dedupeKey: `alert:${kind === 'fired' ? 'alert.event.created' : 'alert.event.resolved'}:${idempotencyKey}`,
                severity: toSeverity(candidate.policy.severity),
                occurredAt: candidate.observedAt,
                payload: buildAlertAutomationEventPayload({
                    alertKey,
                    kind,
                    candidate,
                    incidentId,
                    occurrenceCount,
                    startedAt,
                }),
                metadata: {
                    ruleId: candidate.policy.ruleId,
                    bindingId: candidate.policy.bindingId,
                    engine: 'fast',
                    source: candidate.source,
                },
            }, client);
            if (kind === 'recovered' || !routingDecision || routingDecision.suppressed) {
                return {
                    alertKey,
                    duplicate: false,
                    suppressed: routingDecision?.suppressed ?? false,
                    state: nextState,
                    event,
                    notificationJobs: [],
                };
            }
            const richPayload = buildAlertNotificationPayload(candidate, routingDecision.decisionHash);
            const jobs = await this.runtime.insertNotificationJobs(routingDecision.targets.map((target) => {
                const destinationIdentity = target.deliveryMode === 'EMAIL_ONLY_RESTRICTED'
                    ? `${target.recipientUserId ?? 'owner'}:${target.recipientRef ?? 'missing'}`
                    : target.channelId ?? target.connectorId ?? target.recipientRef ?? 'default';
                return {
                    organizationId: candidate.organizationId,
                    projectId: candidate.projectId ?? null,
                    alertEventId: event.id,
                    alertKey,
                    ruleId: candidate.policy.ruleId,
                    bindingId: candidate.policy.bindingId,
                    channelId: target.channelId,
                    channelKind: target.channelKind,
                    connectorId: target.connectorId,
                    routeId: target.routeId,
                    recipientUserId: target.recipientUserId,
                    recipientRef: target.recipientRef,
                    notificationType: candidate.kind === 'recovered' ? 'alert.recovered' : 'alert',
                    deliveryMode: target.deliveryMode,
                    recipientType: target.recipientType,
                    provider: target.provider,
                    severity: toSeverity(candidate.policy.severity),
                    payload: {
                        ...richPayload,
                        alertEventId: event.id,
                        channelId: target.channelId,
                        channelKind: target.channelKind,
                        connectorId: target.connectorId,
                        recipientRef: target.recipientRef,
                        recipientUserId: target.recipientUserId,
                    },
                    idempotencyKey: hash(`${event.id}:${destinationIdentity}:alert:0:0`),
                    routingDecisionHash: routingDecision.decisionHash,
                    billable: target.channelKind !== 'in_app',
                };
            }), client);
            await this.runtime.appendLedger(jobs.map((job) => ({
                organizationId: candidate.organizationId,
                ruleId: candidate.policy.ruleId,
                bindingId: candidate.policy.bindingId,
                alertKey,
                channelKind: job.channel_kind,
                recipientUserId: job.recipient_user_id,
                notificationJobId: job.id,
            })), client);
            this.log.info({
                alertKey,
                alertEventId: event.id,
                organizationId: candidate.organizationId,
                notificationJobCount: jobs.length,
                jobIds: jobs.map((job) => job.id),
            }, 'notification jobs created');
            return { alertKey, duplicate: false, suppressed: false, state: state.state, event, notificationJobs: jobs };
        });
        this.log.debug({ alertKey, duplicate: result.duplicate, jobs: result.notificationJobs.length }, 'Alert decision persisted');
        return result;
    }
}
function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}
function toSeverity(value) {
    if (value === 'debug' || value === 'info' || value === 'warning' || value === 'error' || value === 'critical' || value === 'fatal')
        return value;
    return 'error';
}
/**
 * Build the canonical alerting -> automation event payload.
 *
 * See docs/automationv2/27-alerting-automation-event-contract.md for the full
 * contract and field derivation. Fields are FLAT at the top level (not nested
 * under a `data`/`resource` envelope) because automation's condition evaluator
 * reads them directly as `$.service`, `$.severity`, etc. — six already-seeded
 * automation templates depend on this exact flat shape.
 */
function buildAlertAutomationEventPayload(input) {
    const { alertKey, kind, candidate, incidentId, occurrenceCount, startedAt } = input;
    const durationMinutes = kind === 'recovered' && startedAt
        ? Math.max(0, Math.round((candidate.observedAt.getTime() - startedAt.getTime()) / 60_000))
        : null;
    return {
        alert_key: alertKey,
        // occurrence_count is null only if no incidents repository is configured or
        // incident persistence failed (both already logged elsewhere); 1 is the
        // correct floor for "this fingerprint has fired at least once".
        fingerprint_count: occurrenceCount ?? 1,
        service: candidate.service ?? null,
        severity: toSeverity(candidate.policy.severity),
        status: kind === 'fired' ? 'firing' : 'resolved',
        incident_id: incidentId,
        duration_minutes: durationMinutes,
        environment: candidate.environment ?? null,
        project_id: candidate.projectId ?? null,
        rule_id: candidate.policy.ruleId,
        observed_value: candidate.observedValue ?? null,
        threshold_value: candidate.thresholdValue ?? null,
        labels: candidate.labels ?? {},
        occurred_at: candidate.observedAt.toISOString(),
    };
}
function severityPriority(value) {
    return { debug: 0, info: 10, warning: 30, error: 70, critical: 90, fatal: 100 }[value] ?? 70;
}
/**
 * Map the alert severity vocabulary onto the incident one.
 *
 * `alert_incidents.severity` uses the primary-db `alert_severity` enum, which has
 * no 'debug'/'fatal'. Collapse them to the nearest meaningful incident severity
 * rather than dropping the incident.
 */
function toIncidentSeverity(value) {
    if (value === 'fatal' || value === 'critical')
        return 'critical';
    if (value === 'error')
        return 'error';
    if (value === 'warning')
        return 'warning';
    return 'info';
}
/** Human-readable incident title, derived from the annotation the engine already builds. */
function incidentTitle(candidate) {
    const annotated = candidate.annotations?.title;
    if (typeof annotated === 'string' && annotated.trim() !== '')
        return annotated.trim();
    const dimension = candidate.dimension ? ` (${candidate.dimension})` : '';
    return `Alert: ${candidate.policy.ruleId}${dimension}`;
}
function toRoutingSeverity(value) {
    if (value === 'critical' || value === 'fatal')
        return 'critical';
    if (value === 'error')
        return 'error';
    if (value === 'warning')
        return 'warning';
    return 'info';
}
//# sourceMappingURL=decision.engine.js.map