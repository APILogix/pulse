/**
 * Canonical Feature Registry & Definitions
 *
 * Defines all billable, gated, and metered capabilities across the Pulse platform.
 * Auto-generated from canonical catalog version 2.0.
 */
export declare enum FeatureCategory {
    FEATURE = "feature",
    QUOTA = "quota",
    INTEGRATION = "integration"
}
export declare enum FeatureScope {
    ORGANIZATION = "organization",
    PROJECT = "project",
    USER = "user"
}
export declare enum EnforcementType {
    NONE = "none",
    HARD_LIMIT = "hard_limit",
    THROTTLE = "throttle",
    OVERAGE = "overage"
}
export type PlanKey = 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
export type FeatureKey = 'organization.enabled' | 'organization.max_orgs_per_user' | 'projects.enabled' | 'quota.projects' | 'quota.members' | 'quota.environments' | 'quota.api_keys' | 'quota.monthly_events' | 'quota.requests_per_second' | 'sdk.enabled' | 'sdk.remote_config' | 'sdk.retry' | 'sdk.batching' | 'sdk.offline_queue' | 'sdk.dynamic_sampling' | 'quota.sdk_batch_queue_size' | 'quota.sdk_offline_queue_limit' | 'privacy.data_scrubbing' | 'privacy.capture_headers' | 'privacy.capture_body' | 'privacy.capture_ip' | 'error_tracking.enabled' | 'tracing.enabled' | 'logging.enabled' | 'metrics.enabled' | 'profiling.enabled' | 'replay.enabled' | 'uptime.enabled' | 'cron_monitoring.enabled' | 'quota.retention_days' | 'alerting.enabled' | 'alerting.rules' | 'alerting.routing.enabled' | 'alerting.composite' | 'alerting.escalation_policies' | 'alerting.on_call' | 'alerting.incident_timeline' | 'alerting.managed_email_fallback' | 'alerting.ai_alert' | 'quota.alert_rules' | 'quota.project_alert_rules' | 'quota.alert_channels' | 'quota.project_notification_channels' | 'quota.routing_rules' | 'quota.project_routing_rules' | 'quota.daily_alerts' | 'quota.monthly_alerts' | 'quota.connector_sends' | 'automation.enabled' | 'quota.automation_rules' | 'dashboards.enabled' | 'dashboards.custom_dashboards' | 'quota.dashboards' | 'analytics.explorer' | 'analytics.query_builder' | 'ai.enabled' | 'ai.summaries' | 'ai.root_cause_analysis' | 'ai.anomaly_detection' | 'ai.forecasting' | 'ai.incident_copilot' | 'quota.ai_credits' | 'integrations.enabled' | 'integrations.rest_api' | 'quota.connectors' | 'integrations.email' | 'integrations.webhook' | 'integrations.slack' | 'integrations.discord' | 'integrations.microsoft_teams' | 'integrations.pagerduty' | 'integrations.sms' | 'security.enabled' | 'security.audit_logs' | 'security.sso' | 'security.scim' | 'security.custom_roles' | 'quota.service_accounts' | 'quota.custom_roles' | 'support.dedicated' | 'support.sla' | 'deployment.custom' | 'compliance.hipaa' | 'compliance.gdpr_dpa';
export interface FeatureDefinition {
    readonly key: FeatureKey;
    readonly name: string;
    readonly type: 'boolean' | 'integer' | 'string';
    readonly category: FeatureCategory | 'feature' | 'quota' | 'integration';
    readonly scope: FeatureScope | 'organization' | 'project' | 'user';
    readonly unit: string;
    readonly enforcementType: EnforcementType | 'none' | 'hard_limit' | 'throttle' | 'overage';
    readonly supportsUnlimited: boolean;
    readonly description: string;
    readonly dependencies?: readonly FeatureKey[];
    readonly overageRate?: number;
    readonly overageUnit?: number;
    readonly gracePercent?: number;
}
export declare class FeatureNotFoundError extends Error {
    readonly key: string;
    constructor(key: string);
}
export declare const CANONICAL_PLANS: readonly PlanKey[];
export declare const SUPPORTED_CONNECTOR_PROVIDERS: readonly ["slack", "discord", "microsoft_teams", "pagerduty", "webhook", "email", "sms"];
/**
 * Authoritative canonical feature registry containing all 84 platform features.
 */
export declare const FEATURE_REGISTRY: Readonly<Record<FeatureKey, FeatureDefinition>>;
export declare const CANONICAL_FEATURE_CATALOG: FeatureDefinition[];
/**
 * Helper to fetch a feature definition by key.
 * Throws FeatureNotFoundError if key does not exist.
 */
export declare function getFeatureByKey(key: FeatureKey): FeatureDefinition;
/**
 * Backwards compatibility alias for getFeatureByKey.
 */
export declare const getFeatureDefinition: typeof getFeatureByKey;
/**
 * Helper to list all feature definitions belonging to a category.
 */
export declare function getFeaturesByCategory(category: FeatureCategory | string): FeatureDefinition[];
/**
 * Helper to list all feature definitions belonging to a scope.
 */
export declare function getFeaturesByScope(scope: FeatureScope | string): FeatureDefinition[];
//# sourceMappingURL=feature-registry.d.ts.map