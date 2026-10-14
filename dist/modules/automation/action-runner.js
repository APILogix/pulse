import { DANGEROUS_ACTIONS } from './types.js';
import { AutomationApprovalRequiredError, AutomationActionNotSupportedError, } from './errors.js';
// ═══════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Build a stable deterministic idempotency key for an action execution.
 * CRITICAL: Omits attempt entirely so the external key is stable across retries.
 * Format: automation:{orgId}:{workflowId}:{runId}:{stepId}
 */
export function buildIdempotencyKey(ctx) {
    return `automation:${ctx.organizationId}:${ctx.workflowId}:${ctx.runId}:${ctx.stepId}`;
}
// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);
function readString(source, key) {
    const v = source[key];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
function readNumber(source, key) {
    const v = source[key];
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n))
            return n;
    }
    return undefined;
}
/**
 * Read a step's pre-execution delay from its action config, in seconds.
 *
 * Accepts either "waitSeconds" or "waitMinutes" (minutes takes the value,
 * seconds wins if both are present). This is a REAL scheduling delay: the
 * caller (createRunWithSteps) sets the step's initial next_retry_at from this
 * value, and claimNextStep() already refuses to claim a queued step whose
 * next_retry_at is in the future — so no new claim-path logic was needed.
 *
 * Exported so both workers.ts (event/schedule-triggered runs) and service.ts
 * (manual runs) apply the same delay semantics to every action type, rather
 * than special-casing it to whichever action happened to first use the word
 * "wait" in a seeded template config.
 */
export function readActionWaitSeconds(config) {
    if (!config)
        return undefined;
    const seconds = readNumber(config, 'waitSeconds');
    if (seconds !== undefined)
        return seconds > 0 ? seconds : undefined;
    const minutes = readNumber(config, 'waitMinutes');
    if (minutes !== undefined)
        return minutes > 0 ? minutes * 60 : undefined;
    return undefined;
}
function readSeverity(ctx, fallback) {
    const raw = readString(ctx.config, 'severity') ?? readString(ctx.inputPayload, 'severity');
    if (raw && VALID_SEVERITIES.has(raw))
        return raw;
    return fallback;
}
function readRecord(source, key) {
    const v = source[key];
    if (v && typeof v === 'object' && !Array.isArray(v))
        return v;
    return undefined;
}
/** Resolve which connector a notification-style action should deliver through. */
function readTarget(ctx, defaultType) {
    return {
        connectorId: readString(ctx.config, 'connectorId'),
        connectorType: readString(ctx.config, 'connectorType') ?? readString(ctx.config, 'channel') ?? defaultType,
    };
}
/**
 * Failure result used when an action's backing integration is not wired up.
 * Deliberately success:false — the step must fail, not silently skip.
 */
function integrationNotConfigured(actionType, dependency) {
    return {
        success: false,
        output: {
            status: 'integration_not_configured',
            actionType,
            requiredIntegration: dependency,
        },
        errorCode: 'INTEGRATION_NOT_CONFIGURED',
        errorMessage: `Action "${actionType}" requires the "${dependency}" integration, which is not configured ` +
            `on this deployment. The step failed rather than reporting a false success.`,
    };
}
/** Failure result for a missing/invalid required config value. */
function invalidConfig(actionType, message) {
    return {
        success: false,
        output: { status: 'invalid_config', actionType },
        errorCode: 'INVALID_ACTION_CONFIG',
        errorMessage: `Action "${actionType}": ${message}`,
    };
}
// ═══════════════════════════════════════════════════════════════════════════════
// ACTION RUNNER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
export class ActionRunnerRegistry {
    handlers = new Map();
    integrations;
    constructor(integrations = {}) {
        this.integrations = integrations;
        this.registerDefaults();
    }
    /** Register a handler for an action type */
    register(handler) {
        this.handlers.set(handler.actionType, handler);
    }
    /** Get a registered handler (or undefined) */
    getHandler(actionType) {
        return this.handlers.get(actionType);
    }
    /** List all registered action types */
    getRegisteredTypes() {
        return [...this.handlers.keys()];
    }
    /**
     * Which action types can actually perform their side effect right now, given the
     * integrations injected into this registry. Surfaced through the API so the UI can
     * tell users an action is unavailable *before* they build a workflow around it.
     */
    getAvailability() {
        const requirements = {
            'notification.send': 'notificationSender',
            'quota.notify': 'notificationSender',
            'security.notify': 'notificationSender',
            'webhook.call': 'notificationSender',
            'pagerduty.trigger': 'notificationSender',
            'connector.delivery.retry': 'connectorRetrier',
            'alert.silence.create': 'alertSilenceCreator',
            'incident.create': 'incidentManager',
            'incident.timeline.append': 'incidentManager',
            'incident.assign_owner': 'incidentManager',
            'approval.request': 'approvalRequester',
            'ai.summary.generate': 'aiSummaryGenerator',
            'ai.root_cause.generate': 'aiSummaryGenerator',
            'incident.postmortem.generate_draft': 'aiSummaryGenerator',
            'report.export': 'reportExporter',
            'ticket.github.create': 'ticketCreator',
            'ticket.jira.create': 'ticketCreator',
        };
        return this.getRegisteredTypes().map((actionType) => {
            const dep = requirements[actionType];
            if (!dep)
                return { actionType, available: true };
            return this.integrations[dep]
                ? { actionType, available: true }
                : { actionType, available: false, requires: dep };
        });
    }
    /**
     * Execute an action with full safety validation:
     *  1. Check handler exists
     *  2. Validate risk/approval (max of handler-declared and context risk)
     *  3. Apply timeout with proper cleanup
     *  4. Execute handler
     */
    async execute(ctx) {
        const handler = this.handlers.get(ctx.actionType);
        if (!handler) {
            throw new AutomationActionNotSupportedError(ctx.actionType);
        }
        // Risk validation: use the MAX of handler-declared risk and context risk
        const RISK_HIERARCHY = { low: 1, medium: 2, high: 3, critical: 4 };
        const handlerRiskLevel = RISK_HIERARCHY[handler.riskLevel] ?? 1;
        const contextRiskLevel = RISK_HIERARCHY[ctx.riskLevel] ?? 1;
        const effectiveRisk = Math.max(handlerRiskLevel, contextRiskLevel);
        if (effectiveRisk >= (RISK_HIERARCHY.high ?? 3) && !ctx.approvalGranted) {
            throw new AutomationApprovalRequiredError(ctx.actionType, ctx.riskLevel);
        }
        // Explicitly-flagged dangerous actions always require approval.
        if (DANGEROUS_ACTIONS.has(ctx.actionType) && !ctx.approvalGranted) {
            throw new AutomationApprovalRequiredError(ctx.actionType, ctx.riskLevel);
        }
        // Execute with timeout — CLEAR timer on completion to avoid leaks
        const timeoutMs = ctx.timeoutSeconds * 1000;
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Action timed out after ${ctx.timeoutSeconds}s`)), timeoutMs);
        });
        try {
            return await Promise.race([handler.execute(ctx), timeoutPromise]);
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    // ═════════════════════════════════════════════════════════════════════════════
    // DEFAULT HANDLER REGISTRATION
    // ═════════════════════════════════════════════════════════════════════════════
    registerDefaults() {
        this.registerNotificationActions();
        this.registerIncidentActions();
        this.registerAlertingActions();
        this.registerAdvisoryActions();
        this.registerIntegrationDependentActions();
    }
    // ── Notification-family actions (all delivered through real connectors) ──────
    /**
     * Shared implementation for every action whose side effect is "deliver a message
     * through one of the organization's configured connectors".
     */
    async sendNotification(ctx, opts) {
        const sender = this.integrations.notificationSender;
        if (!sender)
            return integrationNotConfigured(ctx.actionType, 'notificationSender');
        const target = readTarget(ctx, opts.defaultConnectorType);
        // For transport-specific actions (webhook.call, pagerduty.trigger) the caller
        // must not be able to silently redirect delivery to a different transport.
        if (opts.requireConnectorType) {
            if (target.connectorType && target.connectorType !== opts.requireConnectorType) {
                return invalidConfig(ctx.actionType, `connectorType must be "${opts.requireConnectorType}" for this action, got "${target.connectorType}".`);
            }
            target.connectorType = opts.requireConnectorType;
        }
        const title = readString(ctx.config, 'title') ?? opts.defaultTitle;
        const body = readString(ctx.config, 'body') ??
            readString(ctx.config, 'message') ??
            `Triggered by automation workflow ${ctx.workflowId} (run ${ctx.runId}).`;
        try {
            const result = await sender.send({
                organizationId: ctx.organizationId,
                projectId: ctx.projectId,
                notificationType: opts.notificationType,
                severity: readSeverity(ctx, opts.defaultSeverity),
                title,
                body,
                url: readString(ctx.config, 'url'),
                target,
                metadata: {
                    ...(readRecord(ctx.config, 'metadata') ?? {}),
                    automationWorkflowId: ctx.workflowId,
                    automationRunId: ctx.runId,
                    automationStepId: ctx.stepId,
                    automationActionKey: ctx.actionKey,
                },
                idempotencyKey: ctx.idempotencyKey,
            });
            return {
                success: result.sent,
                output: {
                    ...(opts.extraOutput ?? {}),
                    sent: result.sent,
                    deduplicated: result.deduplicated,
                    deliveryId: result.deliveryId,
                    connectorId: result.connectorId,
                    connectorType: result.connectorType,
                    deliveryStatus: result.status,
                },
                ...(result.sent
                    ? {}
                    : {
                        errorCode: 'DELIVERY_FAILED',
                        errorMessage: `Notification delivery ended in status "${result.status}".`,
                    }),
            };
        }
        catch (err) {
            return {
                success: false,
                output: { status: 'delivery_error', actionType: ctx.actionType },
                errorCode: 'DELIVERY_ERROR',
                errorMessage: err instanceof Error ? err.message : String(err),
            };
        }
    }
    registerNotificationActions() {
        this.register({
            actionType: 'notification.send',
            riskLevel: 'low',
            execute: (ctx) => this.sendNotification(ctx, {
                notificationType: 'automation.notification',
                defaultSeverity: 'info',
                defaultTitle: 'Automation notification',
            }),
        });
        this.register({
            actionType: 'quota.notify',
            riskLevel: 'low',
            execute: (ctx) => this.sendNotification(ctx, {
                notificationType: 'automation.quota',
                defaultSeverity: 'warning',
                defaultTitle: 'Quota threshold reached',
                extraOutput: { category: 'quota' },
            }),
        });
        this.register({
            actionType: 'security.notify',
            riskLevel: 'low',
            execute: (ctx) => this.sendNotification(ctx, {
                notificationType: 'automation.security',
                defaultSeverity: 'critical',
                defaultTitle: 'Security event detected',
                extraOutput: { category: 'security' },
            }),
        });
        /**
         * webhook.call delivers through a `webhook` connector the organization has
         * already created. It deliberately does NOT accept an inline URL: that keeps
         * SSRF validation (connectors/shared/http.ts -> validateWebhookUrl) and secret
         * storage (encrypted connector_credentials) inside the connectors subsystem
         * instead of trusting a URL typed into a workflow definition.
         */
        this.register({
            actionType: 'webhook.call',
            riskLevel: 'medium',
            execute: async (ctx) => {
                if (readString(ctx.config, 'url')) {
                    return invalidConfig('webhook.call', 'inline "url" is not supported. Create a webhook connector and reference it via ' +
                        '"connectorId" so the destination is SSRF-validated and its secrets stay encrypted.');
                }
                return this.sendNotification(ctx, {
                    notificationType: 'automation.webhook',
                    defaultSeverity: 'info',
                    defaultTitle: 'Automation webhook',
                    requireConnectorType: 'webhook',
                });
            },
        });
        this.register({
            actionType: 'pagerduty.trigger',
            riskLevel: 'medium',
            execute: (ctx) => this.sendNotification(ctx, {
                notificationType: 'automation.pagerduty',
                defaultSeverity: 'critical',
                defaultTitle: 'Automation triggered PagerDuty incident',
                requireConnectorType: 'pagerduty',
            }),
        });
        this.register({
            actionType: 'connector.delivery.retry',
            riskLevel: 'low',
            execute: async (ctx) => {
                const retrier = this.integrations.connectorRetrier;
                if (!retrier)
                    return integrationNotConfigured('connector.delivery.retry', 'connectorRetrier');
                const deliveryId = readString(ctx.config, 'deliveryId') ?? readString(ctx.inputPayload, 'deliveryId');
                if (!deliveryId) {
                    return invalidConfig('connector.delivery.retry', 'a "deliveryId" is required in the action config or the trigger payload.');
                }
                try {
                    const result = await retrier.retry({
                        organizationId: ctx.organizationId,
                        deliveryId,
                        idempotencyKey: ctx.idempotencyKey,
                        metadata: { runId: ctx.runId, stepId: ctx.stepId },
                    });
                    return {
                        success: result.retried,
                        output: {
                            retried: result.retried,
                            deliveryId,
                            newDeliveryId: result.newDeliveryId ?? null,
                            status: result.status,
                        },
                        ...(result.retried
                            ? {}
                            : {
                                errorCode: 'RETRY_REJECTED',
                                errorMessage: `Delivery ${deliveryId} was not retried (status "${result.status}").`,
                            }),
                    };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'retry_error', deliveryId },
                        errorCode: 'RETRY_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
    }
    // ── Incident actions (backed by alert_incidents / alert_incident_events) ─────
    registerIncidentActions() {
        this.register({
            actionType: 'incident.create',
            riskLevel: 'medium',
            execute: async (ctx) => {
                const incidents = this.integrations.incidentManager;
                if (!incidents)
                    return integrationNotConfigured('incident.create', 'incidentManager');
                const title = readString(ctx.config, 'title') ??
                    readString(ctx.inputPayload, 'title') ??
                    `Automation incident from workflow ${ctx.workflowId}`;
                try {
                    const result = await incidents.createIncident({
                        organizationId: ctx.organizationId,
                        projectId: ctx.projectId,
                        title,
                        severity: readSeverity(ctx, 'critical'),
                        service: readString(ctx.config, 'service') ?? readString(ctx.inputPayload, 'service'),
                        environment: readString(ctx.config, 'environment') ?? readString(ctx.inputPayload, 'environment'),
                        labels: {
                            ...(readRecord(ctx.config, 'labels') ?? {}),
                            source: 'automation',
                            workflowId: ctx.workflowId,
                            runId: ctx.runId,
                        },
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return {
                        success: true,
                        output: {
                            incidentId: result.incidentId,
                            // false => an active incident already existed and was reused; this is
                            // correct dedup behaviour, not a failure.
                            created: result.created,
                            reusedExisting: !result.created,
                            status: result.status,
                        },
                    };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'incident_create_error' },
                        errorCode: 'INCIDENT_CREATE_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
        this.register({
            actionType: 'incident.timeline.append',
            riskLevel: 'low',
            execute: async (ctx) => {
                const incidents = this.integrations.incidentManager;
                if (!incidents)
                    return integrationNotConfigured('incident.timeline.append', 'incidentManager');
                const incidentId = readString(ctx.config, 'incidentId') ?? readString(ctx.inputPayload, 'incidentId');
                if (!incidentId) {
                    return invalidConfig('incident.timeline.append', 'an "incidentId" is required in the action config or the trigger payload.');
                }
                try {
                    const result = await incidents.appendTimelineEvent({
                        organizationId: ctx.organizationId,
                        projectId: ctx.projectId,
                        incidentId,
                        kind: readString(ctx.config, 'kind') ?? 'condition_still_breaching',
                        detail: {
                            ...(readRecord(ctx.config, 'detail') ?? {}),
                            note: readString(ctx.config, 'note'),
                            source: 'automation',
                            workflowId: ctx.workflowId,
                            runId: ctx.runId,
                        },
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return { success: result.appended, output: { appended: result.appended, incidentId } };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'timeline_append_error', incidentId },
                        errorCode: 'INCIDENT_TIMELINE_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
        this.register({
            actionType: 'incident.assign_owner',
            riskLevel: 'medium',
            execute: async (ctx) => {
                const incidents = this.integrations.incidentManager;
                if (!incidents)
                    return integrationNotConfigured('incident.assign_owner', 'incidentManager');
                const incidentId = readString(ctx.config, 'incidentId') ?? readString(ctx.inputPayload, 'incidentId');
                const assigneeUserId = readString(ctx.config, 'assigneeUserId') ?? readString(ctx.config, 'assignTo');
                if (!incidentId) {
                    return invalidConfig('incident.assign_owner', 'an "incidentId" is required.');
                }
                if (!assigneeUserId) {
                    return invalidConfig('incident.assign_owner', 'an "assigneeUserId" is required.');
                }
                try {
                    const result = await incidents.assignOwner({
                        organizationId: ctx.organizationId,
                        incidentId,
                        assigneeUserId,
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return {
                        success: result.assigned,
                        output: { assigned: result.assigned, incidentId, assigneeUserId },
                        ...(result.assigned
                            ? {}
                            : {
                                errorCode: 'INCIDENT_ASSIGN_REJECTED',
                                errorMessage: `Incident ${incidentId} could not be assigned (not found, or not owned by this organization).`,
                            }),
                    };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'assign_error', incidentId },
                        errorCode: 'INCIDENT_ASSIGN_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
    }
    // ── Alerting actions ────────────────────────────────────────────────────────
    registerAlertingActions() {
        this.register({
            actionType: 'alert.silence.create',
            riskLevel: 'medium',
            execute: async (ctx) => {
                const silencer = this.integrations.alertSilenceCreator;
                if (!silencer)
                    return integrationNotConfigured('alert.silence.create', 'alertSilenceCreator');
                // Accept "durationMinutes" as well as "durationSeconds": the seeded
                // deduplicate-noisy-alerts template used durationMinutes, which this
                // handler never read (a dead config key — found during production
                // readiness review). durationSeconds, if present, always wins.
                const durationMinutes = readNumber(ctx.config, 'durationMinutes');
                const durationSeconds = readNumber(ctx.config, 'durationSeconds')
                    ?? (durationMinutes !== undefined ? durationMinutes * 60 : undefined)
                    ?? 3600;
                if (durationSeconds <= 0 || durationSeconds > 20_160 * 60) {
                    return invalidConfig('alert.silence.create', `"durationSeconds" must be between 1 and ${20_160 * 60} (14 days), got ${durationSeconds}.`);
                }
                try {
                    const result = await silencer.createSilence({
                        organizationId: ctx.organizationId,
                        workflowId: ctx.workflowId,
                        ruleId: readString(ctx.config, 'ruleId') ?? readString(ctx.inputPayload, 'ruleId'),
                        matchers: readRecord(ctx.config, 'matchers') ?? {},
                        durationSeconds,
                        reason: readString(ctx.config, 'reason') ??
                            `Silenced by automation workflow ${ctx.workflowId} (run ${ctx.runId})`,
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return {
                        success: true,
                        output: {
                            silenceId: result.silenceId,
                            startsAt: result.startsAt,
                            endsAt: result.endsAt,
                            durationSeconds,
                        },
                    };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'silence_error' },
                        errorCode: 'ALERT_SILENCE_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
    }
    // ── Advisory / control-flow actions (no external dependency) ────────────────
    registerAdvisoryActions() {
        this.register({
            actionType: 'approval.request',
            riskLevel: 'low',
            execute: async (ctx) => {
                const requester = this.integrations.approvalRequester;
                if (!requester)
                    return integrationNotConfigured('approval.request', 'approvalRequester');
                try {
                    const result = await requester.requestApproval({
                        organizationId: ctx.organizationId,
                        workflowId: ctx.workflowId,
                        runId: ctx.runId,
                        stepId: ctx.stepId,
                        riskLevel: ctx.riskLevel,
                        actionType: ctx.actionType,
                        payload: ctx.inputPayload,
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return {
                        success: true,
                        output: { approvalId: result.approvalId, status: result.status },
                    };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'approval_request_error' },
                        errorCode: 'APPROVAL_REQUEST_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
        /**
         * rollback.recommend is advisory by design: it records a recommendation and
         * never performs a destructive rollback. It is honest about that in its output
         * rather than implying a rollback occurred.
         */
        this.register({
            actionType: 'rollback.recommend',
            riskLevel: 'medium',
            execute: async (ctx) => ({
                success: true,
                output: {
                    recommendation: 'rollback_recommended',
                    advisoryOnly: true,
                    reason: readString(ctx.config, 'reason') ?? 'Health degradation detected',
                    service: readString(ctx.config, 'service') ?? readString(ctx.inputPayload, 'service') ?? null,
                    workflowId: ctx.workflowId,
                    runId: ctx.runId,
                    note: 'Advisory only: this action never executes a rollback.',
                },
            }),
        });
        this.register({
            actionType: 'noop',
            riskLevel: 'low',
            execute: async () => ({
                success: true,
                output: { action: 'noop', note: 'No operation performed, by design.' },
            }),
        });
    }
    // ── Actions requiring an integration that does not exist in-product yet ──────
    registerIntegrationDependentActions() {
        const aiActions = [
            { type: 'ai.summary.generate', kind: 'summary', risk: 'low' },
            { type: 'ai.root_cause.generate', kind: 'root_cause', risk: 'low' },
            { type: 'incident.postmortem.generate_draft', kind: 'postmortem_draft', risk: 'low' },
        ];
        for (const { type, kind, risk } of aiActions) {
            this.register({
                actionType: type,
                riskLevel: risk,
                execute: async (ctx) => {
                    const ai = this.integrations.aiSummaryGenerator;
                    if (!ai)
                        return integrationNotConfigured(type, 'aiSummaryGenerator');
                    try {
                        const result = await ai.generateSummary({
                            organizationId: ctx.organizationId,
                            workflowId: ctx.workflowId,
                            context: { ...ctx.inputPayload, ...ctx.config },
                            type: kind,
                            idempotencyKey: ctx.idempotencyKey,
                        });
                        return {
                            success: true,
                            output: { kind, content: result.content, creditsUsed: result.creditsUsed },
                        };
                    }
                    catch (err) {
                        return {
                            success: false,
                            output: { status: 'ai_error', kind },
                            errorCode: 'AI_GENERATION_ERROR',
                            errorMessage: err instanceof Error ? err.message : String(err),
                        };
                    }
                },
            });
        }
        this.register({
            actionType: 'report.export',
            riskLevel: 'low',
            execute: async (ctx) => {
                const exporter = this.integrations.reportExporter;
                if (!exporter)
                    return integrationNotConfigured('report.export', 'reportExporter');
                try {
                    const result = await exporter.export({
                        organizationId: ctx.organizationId,
                        reportType: readString(ctx.config, 'reportType') ?? 'generic',
                        config: ctx.config,
                        idempotencyKey: ctx.idempotencyKey,
                    });
                    return { success: true, output: { reportId: result.reportId, url: result.url ?? null } };
                }
                catch (err) {
                    return {
                        success: false,
                        output: { status: 'report_error' },
                        errorCode: 'REPORT_EXPORT_ERROR',
                        errorMessage: err instanceof Error ? err.message : String(err),
                    };
                }
            },
        });
        const ticketActions = [
            { type: 'ticket.github.create', provider: 'github' },
            { type: 'ticket.jira.create', provider: 'jira' },
        ];
        for (const { type, provider } of ticketActions) {
            this.register({
                actionType: type,
                riskLevel: 'medium',
                execute: async (ctx) => {
                    const tickets = this.integrations.ticketCreator;
                    if (!tickets)
                        return integrationNotConfigured(type, 'ticketCreator');
                    try {
                        const result = await tickets.createTicket({
                            organizationId: ctx.organizationId,
                            provider,
                            title: readString(ctx.config, 'title') ??
                                `Automation ticket from workflow ${ctx.workflowId}`,
                            body: readString(ctx.config, 'body') ?? JSON.stringify(ctx.inputPayload),
                            labels: Array.isArray(ctx.config.labels)
                                ? ctx.config.labels.filter((l) => typeof l === 'string')
                                : undefined,
                            config: ctx.config,
                            idempotencyKey: ctx.idempotencyKey,
                        });
                        return { success: true, output: { ticketId: result.ticketId, url: result.url ?? null, provider } };
                    }
                    catch (err) {
                        return {
                            success: false,
                            output: { status: 'ticket_error', provider },
                            errorCode: 'TICKET_CREATE_ERROR',
                            errorMessage: err instanceof Error ? err.message : String(err),
                        };
                    }
                },
            });
        }
    }
}
/**
 * Create an ActionRunnerRegistry with optional integrations injected.
 * Prefer createAutomationIntegrations() from ./integrations.js to build the real set.
 */
export function createActionRunner(integrations) {
    return new ActionRunnerRegistry(integrations ?? {});
}
//# sourceMappingURL=action-runner.js.map