/**
 * Automation module – Centralized feature entitlement key mapping.
 *
 * Maps action types, trigger types, and capabilities to the EXACT billing-seed
 * feature keys from 026_enterprise_module_billing_seed.sql.
 *
 * Used for pre-execution checks and metadata enrichment of read endpoints.
 */
// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE KEY CONSTANTS – Exact billing-seed keys
// ═══════════════════════════════════════════════════════════════════════════════
export const FEATURE_KEYS = {
    // Core automation
    AUTOMATION_ENABLED: 'module_automation_enabled',
    // Automation subfeatures (exact billing keys)
    AUTOMATION_WEBHOOKS: 'module_automation_features_webhooks',
    AUTOMATION_SCHEDULED_WORKFLOWS: 'module_automation_features_scheduled_workflows',
    AUTOMATION_APPROVAL_STEPS: 'module_automation_features_approval_steps',
    // Alerting
    ALERTING_ENABLED: 'module_alerting_enabled',
    ALERTING_MULTI_CHANNEL: 'module_alerting_features_multi_channel',
    ALERTING_ESCALATION: 'module_alerting_features_escalation_policies',
    ALERTING_DEDUPLICATION: 'module_alerting_features_deduplication',
    ALERTING_SILENCING: 'module_alerting_features_silencing',
    // Incident management
    INCIDENT_MANAGEMENT_ENABLED: 'module_incident_management_enabled',
    INCIDENT_TIMELINES: 'module_incident_management_features_timelines',
    INCIDENT_POSTMORTEMS: 'module_incident_management_features_postmortems',
    // Version management / release gates
    VERSION_MANAGEMENT_ENABLED: 'module_version_management_enabled',
    RELEASE_GATES: 'module_version_management_features_release_gates',
    // AI insights
    AI_INSIGHTS_ENABLED: 'module_ai_insights_enabled',
    AI_INCIDENT_SUMMARY: 'module_ai_insights_features_incident_summary',
    AI_ROOT_CAUSE: 'module_ai_insights_features_root_cause_analysis',
    AI_WEEKLY_REPORT: 'module_ai_insights_features_weekly_report',
    // Connectors
    CONNECTORS_ENABLED: 'module_connectors_enabled',
    // Billing operations
    BILLING_OPS_COST_ALERTS: 'module_billing_ops_cost_alerts',
    // Cron monitoring
    CRON_MONITORING: 'module_cron_monitoring_enabled',
    // Uptime monitoring
    UPTIME_MONITORING: 'module_uptime_monitoring_enabled',
    // Enterprise features
    ENTERPRISE_AUDIT_LOGS: 'module_enterprise_features_audit_logs',
    // Analytics
    ANALYTICS_CUSTOM_REPORTS: 'module_analytics_features_custom_reports',
};
// ═══════════════════════════════════════════════════════════════════════════════
// ACTION → FEATURE KEY MAPPING (conservative: use the most specific key)
// ═══════════════════════════════════════════════════════════════════════════════
export const ACTION_FEATURE_MAP = {
    'notification.send': FEATURE_KEYS.ALERTING_MULTI_CHANNEL,
    'incident.create': FEATURE_KEYS.INCIDENT_MANAGEMENT_ENABLED,
    'incident.assign_owner': FEATURE_KEYS.INCIDENT_MANAGEMENT_ENABLED,
    'incident.timeline.append': FEATURE_KEYS.INCIDENT_TIMELINES,
    'incident.postmortem.generate_draft': FEATURE_KEYS.INCIDENT_POSTMORTEMS,
    'ticket.github.create': FEATURE_KEYS.CONNECTORS_ENABLED,
    'ticket.jira.create': FEATURE_KEYS.CONNECTORS_ENABLED,
    'pagerduty.trigger': FEATURE_KEYS.CONNECTORS_ENABLED,
    'connector.delivery.retry': FEATURE_KEYS.CONNECTORS_ENABLED,
    'alert.silence.create': FEATURE_KEYS.ALERTING_SILENCING,
    'ai.summary.generate': FEATURE_KEYS.AI_INCIDENT_SUMMARY,
    'ai.root_cause.generate': FEATURE_KEYS.AI_ROOT_CAUSE,
    'report.export': FEATURE_KEYS.ANALYTICS_CUSTOM_REPORTS,
    'rollback.recommend': FEATURE_KEYS.RELEASE_GATES,
    'quota.notify': FEATURE_KEYS.BILLING_OPS_COST_ALERTS,
    'security.notify': FEATURE_KEYS.ENTERPRISE_AUDIT_LOGS,
    'webhook.call': FEATURE_KEYS.AUTOMATION_WEBHOOKS,
    // Removed action types previously mapped here: runbook.open,
    // runbook.step.create, status_page.update (no backing entity);
    // alert.severity.change (conflicts with the alerting decision engine);
    // release.guard.warn/pause, quota.throttle_recommend (duplicates / nothing to
    // act on); retention.archive, retention.purge_request (platform-level and
    // irreversible-deletion, never tenant-automatable).
    // See docs/automationv2/24-action-inventory-and-decisions.md
};
// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER → FEATURE KEY MAPPING (conservative)
// ═══════════════════════════════════════════════════════════════════════════════
export const TRIGGER_FEATURE_MAP = {
    'alert.event.created': FEATURE_KEYS.ALERTING_ENABLED,
    'alert.event.acknowledged': FEATURE_KEYS.ALERTING_ENABLED,
    'alert.event.resolved': FEATURE_KEYS.ALERTING_ENABLED,
    'alert.event.escalated': FEATURE_KEYS.ALERTING_ESCALATION,
    'alert.rule.firing': FEATURE_KEYS.ALERTING_ENABLED,
    'error.group.created': FEATURE_KEYS.AUTOMATION_ENABLED,
    'error.group.regressed': FEATURE_KEYS.AUTOMATION_ENABLED,
    'trace.latency.baseline_breached': FEATURE_KEYS.AUTOMATION_ENABLED,
    'log.pattern.spike': FEATURE_KEYS.AUTOMATION_ENABLED,
    'metric.threshold_breached': FEATURE_KEYS.AUTOMATION_ENABLED,
    'cron.missed': FEATURE_KEYS.CRON_MONITORING,
    'uptime.failed': FEATURE_KEYS.UPTIME_MONITORING,
    'slo.burn_rate_breached': FEATURE_KEYS.AUTOMATION_ENABLED,
    'release.deployed': FEATURE_KEYS.VERSION_MANAGEMENT_ENABLED,
    'release.health_degraded': FEATURE_KEYS.RELEASE_GATES,
    'ai.root_cause.confidence_breached': FEATURE_KEYS.AI_ROOT_CAUSE,
    'billing.usage.threshold_breached': FEATURE_KEYS.BILLING_OPS_COST_ALERTS,
    'billing.plan.changed': FEATURE_KEYS.BILLING_OPS_COST_ALERTS,
    'connector.delivery.failed': FEATURE_KEYS.CONNECTORS_ENABLED,
    'connector.delivery.dead_lettered': FEATURE_KEYS.CONNECTORS_ENABLED,
    'billing.webhook.dead_lettered': FEATURE_KEYS.BILLING_OPS_COST_ALERTS,
    'ingestion.dead_letter.created': FEATURE_KEYS.AUTOMATION_ENABLED,
    'security.api_key.suspicious_usage': FEATURE_KEYS.ENTERPRISE_AUDIT_LOGS,
    'security.sso.failed_spike': FEATURE_KEYS.ENTERPRISE_AUDIT_LOGS,
    'security.scim.failed_spike': FEATURE_KEYS.ENTERPRISE_AUDIT_LOGS,
    'security.export.spike': FEATURE_KEYS.ENTERPRISE_AUDIT_LOGS,
    'schedule.cron': FEATURE_KEYS.AUTOMATION_SCHEDULED_WORKFLOWS,
    'webhook.received': FEATURE_KEYS.AUTOMATION_WEBHOOKS,
};
// ═══════════════════════════════════════════════════════════════════════════════
// BATCH ENTITLEMENT CHECK
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Collect all required feature keys for a set of actions + trigger.
 * Used for batch entitlement checking to avoid N+1 queries.
 *
 * Automatically adds:
 * - module_automation_features_approval_steps when any action requires approval
 * - module_automation_features_scheduled_workflows for schedule.cron trigger
 * - module_automation_features_webhooks for webhook trigger/call
 */
export function collectRequiredFeatureKeys(triggerType, actionTypes, options) {
    const keys = new Set();
    // Always require base automation
    keys.add(FEATURE_KEYS.AUTOMATION_ENABLED);
    // Trigger entitlement
    const triggerKey = TRIGGER_FEATURE_MAP[triggerType];
    if (triggerKey)
        keys.add(triggerKey);
    // Action entitlements
    for (let i = 0; i < actionTypes.length; i++) {
        const actionType = actionTypes[i];
        const actionKey = ACTION_FEATURE_MAP[actionType];
        if (actionKey)
            keys.add(actionKey);
        // If action requires approval, add the approval_steps subfeature key
        if (options?.actionRequiresApproval?.[i]) {
            keys.add(FEATURE_KEYS.AUTOMATION_APPROVAL_STEPS);
        }
    }
    return [...keys];
}
/**
 * Batch-check entitlements using a pre-fetched map.
 * Returns { allowed: true } if all pass, or { allowed: false, missing: [...keys] }.
 */
export function batchCheckEntitlementsFromMap(requiredKeys, entitlementMap) {
    const missing = requiredKeys.filter((key) => !entitlementMap.get(key));
    return { allowed: missing.length === 0, missing };
}
/**
 * Produce metadata for read endpoints showing feature availability.
 * Uses a synchronous checker (pre-loaded entitlement map).
 */
export function enrichWithEntitlementMetadata(triggerType, actionTypes, entitlementChecker) {
    const requiredKeys = collectRequiredFeatureKeys(triggerType, actionTypes);
    const unavailableFeatures = [];
    for (const key of requiredKeys) {
        if (!entitlementChecker(key)) {
            unavailableFeatures.push({ key, reason: `Entitlement "${key}" not active for this organization` });
        }
    }
    return {
        requiredFeatureKeys: requiredKeys,
        automationAvailable: unavailableFeatures.length === 0,
        unavailableFeatures,
    };
}
//# sourceMappingURL=entitlements.js.map