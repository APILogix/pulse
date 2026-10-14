/**
 * Automation module – types, constants, and interfaces.
 *
 * Enterprise automation workflows orchestrate triggers, conditions, approvals,
 * actions, retries, and audit trails. They are NOT alert rules.
 *
 * All enums/constants match the canonical migration draft 19_automation.
 */
export declare const WORKFLOW_TYPES: readonly ["alert_routing", "escalation", "incident_creation", "incident_timeline", "postmortem", "release_guard", "rollback_recommendation", "noise_reduction", "remediation", "runbook", "connector", "data_retention", "quota", "anomaly", "dead_letter", "security", "report", "custom"];
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];
export declare const TRIGGER_TYPES: readonly ["alert.event.created", "alert.event.acknowledged", "alert.event.resolved", "alert.event.escalated", "alert.rule.firing", "error.group.created", "error.group.regressed", "trace.latency.baseline_breached", "log.pattern.spike", "metric.threshold_breached", "cron.missed", "uptime.failed", "slo.burn_rate_breached", "release.deployed", "release.health_degraded", "ai.root_cause.confidence_breached", "billing.usage.threshold_breached", "billing.plan.changed", "connector.delivery.failed", "connector.delivery.dead_lettered", "billing.webhook.dead_lettered", "ingestion.dead_letter.created", "security.api_key.suspicious_usage", "security.sso.failed_spike", "security.scim.failed_spike", "security.export.spike", "schedule.cron", "manual.run", "webhook.received"];
export type TriggerType = (typeof TRIGGER_TYPES)[number];
/**
 * Supported automation action types.
 *
 * Every type listed here either performs a real side effect, or fails explicitly
 * with INTEGRATION_NOT_CONFIGURED when its backing integration is absent.
 * No action type in this list silently pretends to succeed.
 *
 * Nine action types were removed (see docs/automationv2/24-action-inventory-and-decisions.md)
 * because they had no backing entity in the schema, duplicated another action, or
 * were unsafe to expose to tenant-authored automation:
 *   runbook.open, runbook.step.create      -> no runbook entity exists anywhere
 *   status_page.update                     -> no status-page subsystem exists
 *   release.guard.warn                     -> duplicate of notification.send
 *   release.guard.pause                    -> project_releases is append-only; nothing to pause
 *   retention.archive                      -> platform-level scheduled concern, not per-tenant
 *   retention.purge_request                -> irreversible data deletion must never be automatable
 *   quota.throttle_recommend               -> advisory duplicate of quota.notify
 *   alert.severity.change                  -> conflicts with the alerting decision engine, which
 *                                             owns severity and only escalates (GREATEST)
 */
export declare const ACTION_TYPES: readonly ["notification.send", "quota.notify", "security.notify", "webhook.call", "pagerduty.trigger", "connector.delivery.retry", "alert.silence.create", "incident.create", "incident.timeline.append", "incident.assign_owner", "approval.request", "rollback.recommend", "noop", "ai.summary.generate", "ai.root_cause.generate", "incident.postmortem.generate_draft", "report.export", "ticket.github.create", "ticket.jira.create"];
export type ActionType = (typeof ACTION_TYPES)[number];
/**
 * Action types that require a configured external integration and have no
 * in-product implementation. When the integration is not injected these MUST
 * fail with INTEGRATION_NOT_CONFIGURED rather than reporting success.
 */
export declare const INTEGRATION_DEPENDENT_ACTIONS: ReadonlySet<ActionType>;
/**
 * Actions requiring explicit human approval before execution.
 *
 * Now empty, and that is a deliberate, narrower-blast-radius design rather than a
 * relaxation of safety. The four previously-listed destructive actions
 * (release.guard.pause, retention.purge_request, quota.throttle_recommend,
 * status_page.update) have been removed from the product entirely, so they can no
 * longer be requested at all — which is strictly safer than gating them.
 *
 * webhook.call was also listed here. It is now implemented as connector-referenced
 * only: it can target exclusively a `webhook` connector the organization already
 * created, whose URL is SSRF-validated at creation and again on every send
 * (connectors/shared/http.ts -> validateWebhookUrl), and whose credentials live
 * encrypted in connector_credentials, never in workflow config. Because the
 * destination is pre-approved infrastructure rather than an arbitrary URL supplied
 * by the rule author, per-run approval added friction without adding safety.
 *
 * Approval enforcement itself remains fully wired: any action whose risk resolves
 * to high/critical still requires approval (see ActionRunnerRegistry.execute), so
 * adding a genuinely dangerous action here — or marking one high-risk in
 * automation_actions.risk_level — re-engages the gate immediately.
 */
export declare const DANGEROUS_ACTIONS: ReadonlySet<ActionType>;
export declare const CONDITION_OPERATORS: readonly ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "not_contains", "matches", "exists", "not_exists", "between"];
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export declare const TRIGGER_KINDS: readonly ["event", "schedule", "manual", "webhook"];
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export declare const WORKFLOW_STATUSES: readonly ["draft", "active", "paused", "archived", "disabled"];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export declare const WORKFLOW_SCOPES: readonly ["organization", "project", "platform"];
export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];
export declare const TEMPLATE_SCOPES: readonly ["platform", "organization"];
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];
export declare const ACTION_RISK_LEVELS: readonly ["low", "medium", "high", "critical"];
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];
export declare const RUN_STATUSES: readonly ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled", "skipped", "timed_out"];
export type RunStatus = (typeof RUN_STATUSES)[number];
export declare const STEP_STATUSES: readonly ["queued", "running", "waiting_approval", "succeeded", "failed", "skipped", "cancelled", "timed_out"];
export type StepStatus = (typeof STEP_STATUSES)[number];
export declare const APPROVAL_STATUSES: readonly ["pending", "approved", "rejected", "expired", "cancelled"];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export declare const AUDIT_ACTIONS: readonly ["workflow.created", "workflow.updated", "workflow.enabled", "workflow.disabled", "workflow.paused", "workflow.archived", "workflow.version_published", "trigger.received", "run.queued", "run.started", "run.completed", "run.failed", "run.cancelled", "step.started", "step.completed", "step.failed", "approval.requested", "approval.approved", "approval.rejected", "template.created"];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export declare const LIMITS: {
    readonly MAX_WORKFLOW_NAME_LENGTH: 150;
    readonly MAX_DESCRIPTION_LENGTH: 2000;
    readonly MAX_TAGS: 20;
    readonly MAX_TAG_LENGTH: 50;
    readonly MAX_CONDITIONS: 50;
    readonly MAX_ACTIONS: 25;
    readonly MAX_PAYLOAD_SIZE_BYTES: 262144;
    readonly MAX_METADATA_SIZE_BYTES: 32768;
    readonly MAX_SLUG_LENGTH: 150;
    readonly MAX_REGEX_LENGTH: 256;
    readonly MAX_CRON_LENGTH: 120;
    readonly MAX_ACTION_KEY_LENGTH: 100;
    readonly MAX_ACTION_TYPE_LENGTH: 120;
    readonly MAX_TRIGGER_TYPE_LENGTH: 120;
    readonly MAX_LEFT_PATH_LENGTH: 300;
    readonly MAX_IDEMPOTENCY_KEY_LENGTH: 300;
    readonly MAX_DEDUPE_KEY_LENGTH: 300;
    readonly MAX_TIMEZONE_LENGTH: 80;
    readonly MIN_TIMEOUT_SECONDS: 1;
    readonly MAX_TIMEOUT_SECONDS: 3600;
    readonly MIN_MAX_ATTEMPTS: 1;
    readonly MAX_MAX_ATTEMPTS: 10;
    readonly MIN_COOLDOWN_SECONDS: 0;
    readonly MAX_COOLDOWN_SECONDS: 86400;
    readonly MAX_RETRY_BACKOFF_SECONDS: 3600;
};
export interface AutomationActionContext {
    /** The run ID */
    runId: string;
    /** The step ID */
    stepId: string;
    /** Organization ID */
    organizationId: string;
    /** Project ID (optional) */
    projectId: string | null;
    /** Workflow ID */
    workflowId: string;
    /** The action type being executed */
    actionType: ActionType;
    /** The action key (unique within workflow) */
    actionKey: string;
    /** Action-specific configuration */
    config: Record<string, unknown>;
    /** The trigger/run input payload */
    inputPayload: Record<string, unknown>;
    /** Deterministic idempotency key for this execution */
    idempotencyKey: string;
    /** Current attempt number (1-based) */
    attempt: number;
    /** Max attempts allowed */
    maxAttempts: number;
    /** Timeout in seconds */
    timeoutSeconds: number;
    /** The risk level of this action */
    riskLevel: ActionRiskLevel;
    /** Whether approval was already granted */
    approvalGranted: boolean;
    /** Metadata from the action definition */
    metadata: Record<string, unknown>;
}
export interface AutomationActionResult {
    /** Whether the action executed successfully */
    success: boolean;
    /** Whether the step should be marked as skipped (e.g. not_implemented) */
    skipped?: boolean;
    /** Output payload to store */
    output: Record<string, unknown>;
    /** Error code if failed */
    errorCode?: string;
    /** Error message if failed */
    errorMessage?: string;
}
export interface AutomationActionHandler {
    actionType: ActionType;
    riskLevel: ActionRiskLevel;
    execute(ctx: AutomationActionContext): Promise<AutomationActionResult>;
}
/**
 * Every integration method receives `idempotencyKey`, the stable per-step key from
 * buildIdempotencyKey() (which deliberately omits the attempt number).
 * Implementations MUST forward it to the underlying provider's own dedup mechanism
 * so a worker crash or queue redelivery cannot produce a duplicate external side
 * effect. This closes the gap where the key was computed but never actually used.
 */
export interface AutomationNotificationTarget {
    /** Explicit connector to deliver through. Always resolved tenant-scoped. */
    connectorId?: string | undefined;
    /** Connector transport to auto-select when no connectorId is given. */
    connectorType?: string | undefined;
}
export interface NotificationSender {
    send(params: {
        organizationId: string;
        projectId?: string | null | undefined;
        /** Logical type, e.g. 'automation.notification', 'automation.quota'. */
        notificationType: string;
        severity: 'info' | 'warning' | 'critical';
        title: string;
        body: string;
        url?: string | undefined;
        fields?: Array<{
            label: string;
            value: string;
        }> | undefined;
        target?: AutomationNotificationTarget | undefined;
        metadata?: Record<string, unknown> | undefined;
        /** Forwarded to the provider dedup/idempotency mechanism. */
        idempotencyKey: string;
    }): Promise<{
        sent: boolean;
        deliveryId: string;
        connectorId: string;
        connectorType: string;
        status: string;
        /** True when the dispatcher/provider suppressed this as a duplicate. */
        deduplicated: boolean;
    }>;
}
export interface ConnectorRetrier {
    retry(params: {
        organizationId: string;
        deliveryId: string;
        idempotencyKey: string;
        metadata?: Record<string, unknown> | undefined;
    }): Promise<{
        retried: boolean;
        newDeliveryId?: string | undefined;
        status: string;
    }>;
}
export interface AlertSilenceCreator {
    createSilence(params: {
        organizationId: string;
        /**
         * Needed because alert_silences.created_by is NOT NULL. The implementation
         * resolves the workflow's owning user rather than inventing a synthetic actor,
         * so the silence is attributable to a real person in the audit trail.
         */
        workflowId: string;
        ruleId?: string | undefined;
        matchers: Record<string, unknown>;
        durationSeconds: number;
        reason: string;
        idempotencyKey: string;
    }): Promise<{
        silenceId: string;
        startsAt: string;
        endsAt: string;
    }>;
}
export interface IncidentManager {
    createIncident(params: {
        organizationId: string;
        projectId?: string | null | undefined;
        title: string;
        severity: 'info' | 'warning' | 'critical';
        service?: string | null | undefined;
        environment?: string | null | undefined;
        labels?: Record<string, unknown> | undefined;
        /** Stable key -> deterministic fingerprint, so retries fold into one incident. */
        idempotencyKey: string;
    }): Promise<{
        incidentId: string;
        created: boolean;
        status: string;
    }>;
    appendTimelineEvent(params: {
        organizationId: string;
        projectId?: string | null | undefined;
        incidentId: string;
        kind: string;
        detail?: Record<string, unknown> | undefined;
        idempotencyKey: string;
    }): Promise<{
        appended: boolean;
        incidentId: string;
    }>;
    assignOwner(params: {
        organizationId: string;
        incidentId: string;
        assigneeUserId: string;
        idempotencyKey: string;
    }): Promise<{
        assigned: boolean;
        incidentId: string;
        assigneeUserId: string;
    }>;
}
export interface AiSummaryGenerator {
    generateSummary(params: {
        organizationId: string;
        /**
         * Needed to resolve the workflow's owning user, who is the accountable
         * actor for AI entitlement/credit checks — same reasoning as
         * AlertSilenceCreator.createSilence's workflowId.
         */
        workflowId: string;
        context: Record<string, unknown>;
        type: 'summary' | 'root_cause' | 'postmortem_draft';
        idempotencyKey: string;
    }): Promise<{
        content: string;
        creditsUsed: number;
    }>;
}
export interface ReportExporter {
    export(params: {
        organizationId: string;
        reportType: string;
        config: Record<string, unknown>;
        idempotencyKey: string;
    }): Promise<{
        reportId: string;
        url?: string | undefined;
    }>;
}
export interface TicketCreator {
    createTicket(params: {
        organizationId: string;
        provider: 'github' | 'jira';
        title: string;
        body: string;
        labels?: string[] | undefined;
        config: Record<string, unknown>;
        idempotencyKey: string;
    }): Promise<{
        ticketId: string;
        url?: string | undefined;
    }>;
}
export interface ApprovalRequester {
    requestApproval(params: {
        organizationId: string;
        workflowId: string;
        runId: string;
        stepId: string;
        riskLevel: ActionRiskLevel;
        actionType: ActionType;
        payload: Record<string, unknown>;
        idempotencyKey: string;
    }): Promise<{
        approvalId: string;
        status: string;
    }>;
}
/**
 * Integrations injected into the action runner.
 *
 * notificationSender / connectorRetrier / alertSilenceCreator / incidentManager /
 * approvalRequester are backed by real in-product subsystems and are wired up in
 * src/modules/automation/integrations.ts.
 *
 * aiSummaryGenerator / reportExporter / ticketCreator have no in-product
 * implementation yet. When absent their actions fail with
 * INTEGRATION_NOT_CONFIGURED rather than reporting a false success.
 */
export interface AutomationIntegrations {
    notificationSender?: NotificationSender;
    connectorRetrier?: ConnectorRetrier;
    alertSilenceCreator?: AlertSilenceCreator;
    incidentManager?: IncidentManager;
    approvalRequester?: ApprovalRequester;
    aiSummaryGenerator?: AiSummaryGenerator;
    reportExporter?: ReportExporter;
    ticketCreator?: TicketCreator;
}
export interface AutomationCondition {
    conditionGroup: string;
    sortOrder: number;
    leftPath: string;
    operator: ConditionOperator;
    rightValue: unknown;
    isRequired: boolean;
}
export interface ConditionEvaluationResult {
    matched: boolean;
    conditionResults: Array<{
        leftPath: string;
        operator: ConditionOperator;
        actual: unknown;
        expected: unknown;
        passed: boolean;
    }>;
}
export interface RequestMeta {
    actorUserId: string;
    actorIp: string;
    actorUserAgent: string | null;
    requestId: string;
}
//# sourceMappingURL=types.d.ts.map