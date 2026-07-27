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
];
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
];
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
];
// ═══════════════════════════════════════════════════════════════════════════════
// DANGEROUS ACTIONS (require approval by default)
// ═══════════════════════════════════════════════════════════════════════════════
export const DANGEROUS_ACTIONS = new Set([
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
];
// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER KINDS
// ═══════════════════════════════════════════════════════════════════════════════
export const TRIGGER_KINDS = ['event', 'schedule', 'manual', 'webhook'];
// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW STATUS
// ═══════════════════════════════════════════════════════════════════════════════
export const WORKFLOW_STATUSES = ['draft', 'active', 'paused', 'archived', 'disabled'];
// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW SCOPE
// ═══════════════════════════════════════════════════════════════════════════════
export const WORKFLOW_SCOPES = ['organization', 'project', 'platform'];
// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE SCOPE
// ═══════════════════════════════════════════════════════════════════════════════
export const TEMPLATE_SCOPES = ['platform', 'organization'];
// ═══════════════════════════════════════════════════════════════════════════════
// ACTION RISK LEVELS
// ═══════════════════════════════════════════════════════════════════════════════
export const ACTION_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
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
];
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
];
// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL STATUS
// ═══════════════════════════════════════════════════════════════════════════════
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'];
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
];
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
};
//# sourceMappingURL=types.js.map