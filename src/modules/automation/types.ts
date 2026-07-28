/**
 * Automation module – types, constants, and interfaces.
 *
 * Enterprise automation workflows orchestrate triggers, conditions, approvals,
 * actions, retries, and audit trails. They are NOT alert rules.
 *
 * All enums/constants match the canonical migration draft 19_automation.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW TYPES (template categories / metadata)
// ═══════════════════════════════════════════════════════════════════════════════

export const WORKFLOW_TYPES = [
  'alert_routing',
  'escalation',
  'incident_creation',
  'incident_timeline',
  'postmortem',
  'release_guard',
  'rollback_recommendation',
  'noise_reduction',
  'remediation',
  'runbook',
  'connector',
  'data_retention',
  'quota',
  'anomaly',
  'dead_letter',
  'security',
  'report',
  'custom',
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const TRIGGER_TYPES = [
  'alert.event.created',
  'alert.event.acknowledged',
  'alert.event.resolved',
  'alert.event.escalated',
  'alert.rule.firing',
  'error.group.created',
  'error.group.regressed',
  'trace.latency.baseline_breached',
  'log.pattern.spike',
  'metric.threshold_breached',
  'cron.missed',
  'uptime.failed',
  'slo.burn_rate_breached',
  'release.deployed',
  'release.health_degraded',
  'ai.root_cause.confidence_breached',
  'billing.usage.threshold_breached',
  'billing.plan.changed',
  'connector.delivery.failed',
  'connector.delivery.dead_lettered',
  'billing.webhook.dead_lettered',
  'ingestion.dead_letter.created',
  'security.api_key.suspicious_usage',
  'security.sso.failed_spike',
  'security.scim.failed_spike',
  'security.export.spike',
  'schedule.cron',
  'manual.run',
  'webhook.received',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const ACTION_TYPES = [
  'notification.send',
  'incident.create',
  'incident.assign_owner',
  'incident.timeline.append',
  'incident.postmortem.generate_draft',
  'ticket.github.create',
  'ticket.jira.create',
  'pagerduty.trigger',
  'runbook.open',
  'runbook.step.create',
  'status_page.update',
  'approval.request',
  'connector.delivery.retry',
  'alert.severity.change',
  'alert.silence.create',
  'ai.summary.generate',
  'ai.root_cause.generate',
  'report.export',
  'rollback.recommend',
  'release.guard.warn',
  'release.guard.pause',
  'quota.notify',
  'quota.throttle_recommend',
  'retention.archive',
  'retention.purge_request',
  'security.notify',
  'webhook.call',
  'noop',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// DANGEROUS ACTIONS (require approval by default)
// ═══════════════════════════════════════════════════════════════════════════════

export const DANGEROUS_ACTIONS: ReadonlySet<ActionType> = new Set([
  'release.guard.pause',
  'retention.purge_request',
  'quota.throttle_recommend',
  'status_page.update',
  'webhook.call', // when external URL is not allowlisted
]);

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION OPERATORS
// ═══════════════════════════════════════════════════════════════════════════════

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'matches',
  'exists',
  'not_exists',
  'between',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER KINDS
// ═══════════════════════════════════════════════════════════════════════════════

export const TRIGGER_KINDS = ['event', 'schedule', 'manual', 'webhook'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const WORKFLOW_STATUSES = ['draft', 'active', 'paused', 'archived', 'disabled'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW SCOPE
// ═══════════════════════════════════════════════════════════════════════════════

export const WORKFLOW_SCOPES = ['organization', 'project', 'platform'] as const;
export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE SCOPE
// ═══════════════════════════════════════════════════════════════════════════════

export const TEMPLATE_SCOPES = ['platform', 'organization'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION RISK LEVELS
// ═══════════════════════════════════════════════════════════════════════════════

export const ACTION_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// RUN STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const RUN_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
  'timed_out',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// STEP STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const STEP_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
  'timed_out',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const AUDIT_ACTIONS = [
  'workflow.created',
  'workflow.updated',
  'workflow.enabled',
  'workflow.disabled',
  'workflow.paused',
  'workflow.archived',
  'workflow.version_published',
  'trigger.received',
  'run.queued',
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'step.started',
  'step.completed',
  'step.failed',
  'approval.requested',
  'approval.approved',
  'approval.rejected',
  'template.created',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ═══════════════════════════════════════════════════════════════════════════════
// LIMITS
// ═══════════════════════════════════════════════════════════════════════════════

export const LIMITS = {
  MAX_WORKFLOW_NAME_LENGTH: 150,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_TAGS: 20,
  MAX_TAG_LENGTH: 50,
  MAX_CONDITIONS: 50,
  MAX_ACTIONS: 25,
  MAX_PAYLOAD_SIZE_BYTES: 262144, // 256 KB
  MAX_METADATA_SIZE_BYTES: 32768, // 32 KB
  MAX_SLUG_LENGTH: 150,
  MAX_REGEX_LENGTH: 256,
  MAX_CRON_LENGTH: 120,
  MAX_ACTION_KEY_LENGTH: 100,
  MAX_ACTION_TYPE_LENGTH: 120,
  MAX_TRIGGER_TYPE_LENGTH: 120,
  MAX_LEFT_PATH_LENGTH: 300,
  MAX_IDEMPOTENCY_KEY_LENGTH: 300,
  MAX_DEDUPE_KEY_LENGTH: 300,
  MAX_TIMEZONE_LENGTH: 80,
  MIN_TIMEOUT_SECONDS: 1,
  MAX_TIMEOUT_SECONDS: 3600,
  MIN_MAX_ATTEMPTS: 1,
  MAX_MAX_ATTEMPTS: 10,
  MIN_COOLDOWN_SECONDS: 0,
  MAX_COOLDOWN_SECONDS: 86400,
  MAX_RETRY_BACKOFF_SECONDS: 3600,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLER ABSTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// DEPENDENCY INJECTION INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export interface NotificationSender {
  send(params: {
    organizationId: string;
    channel?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ sent: boolean; messageId?: string }>;
}

export interface ConnectorRetrier {
  retry(params: {
    organizationId: string;
    deliveryId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ retried: boolean; newDeliveryId?: string }>;
}

export interface AlertSilenceCreator {
  createSilence(params: {
    organizationId: string;
    matchers: Record<string, string>;
    durationSeconds: number;
    reason: string;
  }): Promise<{ silenceId: string }>;
}

export interface AiSummaryGenerator {
  generateSummary(params: {
    organizationId: string;
    context: Record<string, unknown>;
    type: 'summary' | 'root_cause';
  }): Promise<{ content: string; creditsUsed: number }>;
}

export interface ReportExporter {
  export(params: {
    organizationId: string;
    reportType: string;
    config: Record<string, unknown>;
  }): Promise<{ reportId: string; url?: string }>;
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
  }): Promise<{ approvalId: string }>;
}

/** External integrations that can be injected into the action runner */
export interface AutomationIntegrations {
  notificationSender?: NotificationSender;
  connectorRetrier?: ConnectorRetrier;
  alertSilenceCreator?: AlertSilenceCreator;
  aiSummaryGenerator?: AiSummaryGenerator;
  reportExporter?: ReportExporter;
  approvalRequester?: ApprovalRequester;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST METADATA (audit context)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RequestMeta {
  actorUserId: string;
  actorIp: string;
  actorUserAgent: string | null;
  requestId: string;
}
