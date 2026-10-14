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
export const ACTION_TYPES = [
    // ── Real side effects, backed by existing infrastructure ──
    'notification.send',
    'quota.notify',
    'security.notify',
    'webhook.call',
    'pagerduty.trigger',
    'connector.delivery.retry',
    'alert.silence.create',
    'incident.create',
    'incident.timeline.append',
    'incident.assign_owner',
    'approval.request',
    'rollback.recommend',
    'noop',
    // ── Require an external integration; fail explicitly when unavailable ──
    'ai.summary.generate',
    'ai.root_cause.generate',
    'incident.postmortem.generate_draft',
    'report.export',
    'ticket.github.create',
    'ticket.jira.create',
];
/**
 * Action types that require a configured external integration and have no
 * in-product implementation. When the integration is not injected these MUST
 * fail with INTEGRATION_NOT_CONFIGURED rather than reporting success.
 */
export const INTEGRATION_DEPENDENT_ACTIONS = new Set([
    'ai.summary.generate',
    'ai.root_cause.generate',
    'incident.postmortem.generate_draft',
    'report.export',
    'ticket.github.create',
    'ticket.jira.create',
]);
// ═══════════════════════════════════════════════════════════════════════════════
// DANGEROUS ACTIONS (require approval by default)
// ═══════════════════════════════════════════════════════════════════════════════
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
export const DANGEROUS_ACTIONS = new Set([]);
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