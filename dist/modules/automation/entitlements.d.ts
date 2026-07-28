/**
 * Automation module – Centralized feature entitlement key mapping.
 *
 * Maps action types, trigger types, and capabilities to the EXACT billing-seed
 * feature keys from 026_enterprise_module_billing_seed.sql.
 *
 * Used for pre-execution checks and metadata enrichment of read endpoints.
 */
import type { ActionType, TriggerType } from './types.js';
export declare const FEATURE_KEYS: {
    readonly AUTOMATION_ENABLED: "module_automation_enabled";
    readonly AUTOMATION_WEBHOOKS: "module_automation_features_webhooks";
    readonly AUTOMATION_SCHEDULED_WORKFLOWS: "module_automation_features_scheduled_workflows";
    readonly AUTOMATION_APPROVAL_STEPS: "module_automation_features_approval_steps";
    readonly ALERTING_ENABLED: "module_alerting_enabled";
    readonly ALERTING_MULTI_CHANNEL: "module_alerting_features_multi_channel";
    readonly ALERTING_ESCALATION: "module_alerting_features_escalation_policies";
    readonly ALERTING_DEDUPLICATION: "module_alerting_features_deduplication";
    readonly ALERTING_SILENCING: "module_alerting_features_silencing";
    readonly INCIDENT_MANAGEMENT_ENABLED: "module_incident_management_enabled";
    readonly INCIDENT_TIMELINES: "module_incident_management_features_timelines";
    readonly INCIDENT_POSTMORTEMS: "module_incident_management_features_postmortems";
    readonly VERSION_MANAGEMENT_ENABLED: "module_version_management_enabled";
    readonly RELEASE_GATES: "module_version_management_features_release_gates";
    readonly AI_INSIGHTS_ENABLED: "module_ai_insights_enabled";
    readonly AI_INCIDENT_SUMMARY: "module_ai_insights_features_incident_summary";
    readonly AI_ROOT_CAUSE: "module_ai_insights_features_root_cause_analysis";
    readonly AI_WEEKLY_REPORT: "module_ai_insights_features_weekly_report";
    readonly CONNECTORS_ENABLED: "module_connectors_enabled";
    readonly BILLING_OPS_COST_ALERTS: "module_billing_ops_cost_alerts";
    readonly CRON_MONITORING: "module_cron_monitoring_enabled";
    readonly UPTIME_MONITORING: "module_uptime_monitoring_enabled";
    readonly ENTERPRISE_AUDIT_LOGS: "module_enterprise_features_audit_logs";
    readonly ANALYTICS_CUSTOM_REPORTS: "module_analytics_features_custom_reports";
};
export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];
export declare const ACTION_FEATURE_MAP: Partial<Record<ActionType, FeatureKey>>;
export declare const TRIGGER_FEATURE_MAP: Partial<Record<TriggerType, FeatureKey>>;
/**
 * Collect all required feature keys for a set of actions + trigger.
 * Used for batch entitlement checking to avoid N+1 queries.
 *
 * Automatically adds:
 * - module_automation_features_approval_steps when any action requires approval
 * - module_automation_features_scheduled_workflows for schedule.cron trigger
 * - module_automation_features_webhooks for webhook trigger/call
 */
export declare function collectRequiredFeatureKeys(triggerType: TriggerType | string, actionTypes: Array<ActionType | string>, options?: {
    actionRequiresApproval?: boolean[];
}): FeatureKey[];
/**
 * Batch-check entitlements using a pre-fetched map.
 * Returns { allowed: true } if all pass, or { allowed: false, missing: [...keys] }.
 */
export declare function batchCheckEntitlementsFromMap(requiredKeys: FeatureKey[], entitlementMap: Map<string, boolean>): {
    allowed: boolean;
    missing: FeatureKey[];
};
/**
 * Produce metadata for read endpoints showing feature availability.
 * Uses a synchronous checker (pre-loaded entitlement map).
 */
export declare function enrichWithEntitlementMetadata(triggerType: TriggerType | string, actionTypes: Array<ActionType | string>, entitlementChecker: (key: string) => boolean): {
    requiredFeatureKeys: FeatureKey[];
    automationAvailable: boolean;
    unavailableFeatures: Array<{
        key: FeatureKey;
        reason: string;
    }>;
};
//# sourceMappingURL=entitlements.d.ts.map