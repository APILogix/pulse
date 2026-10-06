/**
 * Plan-to-Feature Entitlement Matrix
 *
 * Defines plan metadata and entitlement values for all 5 platform plans.
 * Auto-generated from catalog version 2.0.
 */
export class PlanNotFoundError extends Error {
    planKey;
    constructor(planKey) {
        super(`Plan '${planKey}' is not defined in the plan matrix.`);
        this.planKey = planKey;
        this.name = 'PlanNotFoundError';
    }
}
/**
 * Authoritative Plan Entitlement Matrix mapping each plan to its 102 feature values.
 */
export const PLAN_MATRIX = {
    'free': {
        plan: {
            id: "seed-plan-free",
            key: 'free',
            name: "Free",
            tier: 'free',
            description: "Perfect for personal projects, prototypes and evaluation. One organization per user.",
            trialDays: 0,
            sortOrder: 1,
            isPublic: true,
            isCustomizable: false,
            nextPlanKey: 'starter',
            badge: null,
            metadata: { "highlightedFeatures": ["error_tracking.enabled", "tracing.enabled", "logging.enabled"], "recommendedFor": "Individual developers and hobby projects", "ctaText": "Get Started Free" },
            prices: [
                {
                    id: "seed-price-free-monthly",
                    provider: "stripe",
                    interval: "monthly",
                    currency: "USD",
                    amountMinor: 0,
                    isDefault: true,
                    metadata: { "display": "$0/mo", "recommended": false },
                },
                {
                    id: "seed-price-free-annual",
                    provider: "stripe",
                    interval: "annual",
                    currency: "USD",
                    amountMinor: 0,
                    isDefault: false,
                    metadata: { "display": "$0/year", "discount": "2 months free" },
                },
            ],
        },
        features: [
            {
                featureKey: 'organization.enabled',
                value: true,
            },
            {
                featureKey: 'organization.max_orgs_per_user',
                value: 1,
            },
            {
                featureKey: 'projects.enabled',
                value: true,
            },
            {
                featureKey: 'quota.projects',
                value: 1,
            },
            {
                featureKey: 'quota.members',
                value: 3,
            },
            {
                featureKey: 'quota.environments',
                value: 2,
            },
            {
                featureKey: 'quota.api_keys',
                value: 2,
            },
            {
                featureKey: 'quota.monthly_events',
                value: 10000,
                overageRate: 50,
                overageUnit: 1000,
                gracePercent: 10,
            },
            {
                featureKey: 'quota.requests_per_second',
                value: 50,
            },
            {
                featureKey: 'sdk.enabled',
                value: true,
            },
            {
                featureKey: 'sdk.remote_config',
                value: false,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.retry',
                value: false,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.batching',
                value: false,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.offline_queue',
                value: false,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.dynamic_sampling',
                value: false,
                dependencies: ['sdk.enabled', 'sdk.remote_config'],
            },
            {
                featureKey: 'quota.sdk_batch_queue_size',
                value: 0,
                dependencies: ['sdk.batching'],
            },
            {
                featureKey: 'quota.sdk_offline_queue_limit',
                value: 0,
                dependencies: ['sdk.offline_queue'],
            },
            {
                featureKey: 'privacy.data_scrubbing',
                value: false,
            },
            {
                featureKey: 'privacy.capture_headers',
                value: false,
            },
            {
                featureKey: 'privacy.capture_body',
                value: false,
            },
            {
                featureKey: 'privacy.capture_ip',
                value: false,
            },
            {
                featureKey: 'error_tracking.enabled',
                value: true,
            },
            {
                featureKey: 'tracing.enabled',
                value: true,
            },
            {
                featureKey: 'logging.enabled',
                value: true,
            },
            {
                featureKey: 'metrics.enabled',
                value: true,
            },
            {
                featureKey: 'profiling.enabled',
                value: false,
            },
            {
                featureKey: 'replay.enabled',
                value: false,
            },
            {
                featureKey: 'uptime.enabled',
                value: false,
            },
            {
                featureKey: 'cron_monitoring.enabled',
                value: false,
                dependencies: ['uptime.enabled'],
            },
            {
                featureKey: 'quota.retention_days',
                value: 7,
            },
            {
                featureKey: 'quota.log_retention_days',
                value: 7,
            },
            {
                featureKey: 'quota.metric_retention_days',
                value: 7,
            },
            {
                featureKey: 'quota.profile_retention_days',
                value: 0,
                dependencies: ['profiling.enabled'],
            },
            {
                featureKey: 'quota.replay_retention_days',
                value: 0,
                dependencies: ['replay.enabled'],
            },
            {
                featureKey: 'quota.trace_retention_days',
                value: 7,
                dependencies: ['tracing.enabled'],
            },
            {
                featureKey: 'quota.audit_log_retention_days',
                value: 0,
                dependencies: ['security.audit_logs'],
            },
            {
                featureKey: 'alerting.enabled',
                value: false,
            },
            {
                featureKey: 'alerting.rules',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.routing.enabled',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.composite',
                value: false,
                dependencies: ['alerting.enabled', 'alerting.rules'],
            },
            {
                featureKey: 'alerting.escalation_policies',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.on_call',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.incident_timeline',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.managed_email_fallback',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.ai_alert',
                value: false,
                dependencies: ['alerting.enabled', 'ai.enabled'],
            },
            {
                featureKey: 'quota.alert_rules',
                value: 0,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.project_alert_rules',
                value: 0,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.alert_channels',
                value: 0,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.notification_channels',
                value: 0,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.project_notification_channels',
                value: 0,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.routing_rules',
                value: 0,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.project_routing_rules',
                value: 0,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.daily_alerts',
                value: 10,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.monthly_alerts',
                value: 100,
                overageRate: 10,
                overageUnit: 100,
                gracePercent: 5,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.connector_sends',
                value: 0,
                overageRate: 25,
                overageUnit: 100,
                gracePercent: 5,
            },
            {
                featureKey: 'automation.enabled',
                value: false,
            },
            {
                featureKey: 'quota.automation_rules',
                value: 0,
                dependencies: ['automation.enabled'],
            },
            {
                featureKey: 'dashboards.enabled',
                value: true,
            },
            {
                featureKey: 'dashboards.custom_dashboards',
                value: false,
                dependencies: ['dashboards.enabled'],
            },
            {
                featureKey: 'dashboards.custom_widgets',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.embeds',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.public_links',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.scheduled_reports',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.dashboards',
                value: 1,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.monthly_reports',
                value: 0,
                dependencies: ['dashboards.scheduled_reports'],
            },
            {
                featureKey: 'analytics.explorer',
                value: false,
            },
            {
                featureKey: 'analytics.query_builder',
                value: false,
                dependencies: ['analytics.explorer'],
            },
            {
                featureKey: 'ai.enabled',
                value: false,
            },
            {
                featureKey: 'ai.summaries',
                value: false,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'ai.root_cause_analysis',
                value: false,
                dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
            },
            {
                featureKey: 'ai.anomaly_detection',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.forecasting',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.incident_copilot',
                value: false,
                dependencies: ['ai.enabled', 'alerting.enabled'],
            },
            {
                featureKey: 'quota.ai_credits',
                value: 0,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'integrations.enabled',
                value: true,
            },
            {
                featureKey: 'integrations.rest_api',
                value: true,
            },
            {
                featureKey: 'quota.connectors',
                value: 2,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'quota.integrations',
                value: 2,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'integrations.email',
                value: true,
            },
            {
                featureKey: 'integrations.webhook',
                value: false,
            },
            {
                featureKey: 'integrations.slack',
                value: false,
            },
            {
                featureKey: 'integrations.discord',
                value: false,
            },
            {
                featureKey: 'integrations.microsoft_teams',
                value: false,
            },
            {
                featureKey: 'integrations.pagerduty',
                value: false,
            },
            {
                featureKey: 'integrations.sms',
                value: false,
            },
            {
                featureKey: 'integrations.github',
                value: false,
            },
            {
                featureKey: 'integrations.gitlab',
                value: false,
            },
            {
                featureKey: 'integrations.bitbucket',
                value: false,
            },
            {
                featureKey: 'integrations.jira',
                value: false,
            },
            {
                featureKey: 'integrations.terraform',
                value: false,
            },
            {
                featureKey: 'security.enabled',
                value: false,
            },
            {
                featureKey: 'security.audit_logs',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.sso',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.scim',
                value: false,
                dependencies: ['security.enabled', 'security.sso'],
            },
            {
                featureKey: 'security.custom_roles',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.service_accounts',
                value: 0,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.custom_roles',
                value: 0,
                dependencies: ['security.custom_roles'],
            },
            {
                featureKey: 'support.dedicated',
                value: false,
            },
            {
                featureKey: 'support.sla',
                value: null,
            },
            {
                featureKey: 'deployment.custom',
                value: false,
            },
            {
                featureKey: 'compliance.hipaa',
                value: false,
            },
            {
                featureKey: 'compliance.gdpr_dpa',
                value: false,
            },
        ],
    },
    'starter': {
        plan: {
            id: "seed-plan-starter",
            key: 'starter',
            name: "Starter",
            tier: 'starter',
            description: "Production-ready observability for small teams. One organization per user.",
            trialDays: 14,
            sortOrder: 2,
            isPublic: true,
            isCustomizable: false,
            nextPlanKey: 'growth',
            badge: "Popular",
            metadata: { "highlightedFeatures": ["alerting.rules", "dashboards.custom_dashboards", "sdk.batching"], "recommendedFor": "Small teams shipping to production", "ctaText": "Start 14-Day Free Trial" },
            prices: [
                {
                    id: "seed-price-starter-monthly",
                    provider: "stripe",
                    interval: "monthly",
                    currency: "USD",
                    amountMinor: 1500,
                    isDefault: true,
                    metadata: { "display": "$15/mo", "recommended": false },
                },
                {
                    id: "seed-price-starter-annual",
                    provider: "stripe",
                    interval: "annual",
                    currency: "USD",
                    amountMinor: 15000,
                    isDefault: false,
                    metadata: { "display": "$150/year", "discount": "2 months free" },
                },
            ],
        },
        features: [
            {
                featureKey: 'organization.enabled',
                value: true,
            },
            {
                featureKey: 'organization.max_orgs_per_user',
                value: 1,
            },
            {
                featureKey: 'projects.enabled',
                value: true,
            },
            {
                featureKey: 'quota.projects',
                value: 5,
            },
            {
                featureKey: 'quota.members',
                value: 10,
            },
            {
                featureKey: 'quota.environments',
                value: 5,
            },
            {
                featureKey: 'quota.api_keys',
                value: 10,
            },
            {
                featureKey: 'quota.monthly_events',
                value: 150000,
                overageRate: 50,
                overageUnit: 1000,
                gracePercent: 10,
            },
            {
                featureKey: 'quota.requests_per_second',
                value: 250,
            },
            {
                featureKey: 'sdk.enabled',
                value: true,
            },
            {
                featureKey: 'sdk.remote_config',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.retry',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.batching',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.offline_queue',
                value: false,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.dynamic_sampling',
                value: false,
                dependencies: ['sdk.enabled', 'sdk.remote_config'],
            },
            {
                featureKey: 'quota.sdk_batch_queue_size',
                value: 1000,
                dependencies: ['sdk.batching'],
            },
            {
                featureKey: 'quota.sdk_offline_queue_limit',
                value: 0,
                dependencies: ['sdk.offline_queue'],
            },
            {
                featureKey: 'privacy.data_scrubbing',
                value: false,
            },
            {
                featureKey: 'privacy.capture_headers',
                value: false,
            },
            {
                featureKey: 'privacy.capture_body',
                value: false,
            },
            {
                featureKey: 'privacy.capture_ip',
                value: false,
            },
            {
                featureKey: 'error_tracking.enabled',
                value: true,
            },
            {
                featureKey: 'tracing.enabled',
                value: true,
            },
            {
                featureKey: 'logging.enabled',
                value: true,
            },
            {
                featureKey: 'metrics.enabled',
                value: true,
            },
            {
                featureKey: 'profiling.enabled',
                value: true,
            },
            {
                featureKey: 'replay.enabled',
                value: true,
            },
            {
                featureKey: 'uptime.enabled',
                value: true,
            },
            {
                featureKey: 'cron_monitoring.enabled',
                value: true,
                dependencies: ['uptime.enabled'],
            },
            {
                featureKey: 'quota.retention_days',
                value: 30,
            },
            {
                featureKey: 'quota.log_retention_days',
                value: 30,
            },
            {
                featureKey: 'quota.metric_retention_days',
                value: 30,
            },
            {
                featureKey: 'quota.profile_retention_days',
                value: 0,
                dependencies: ['profiling.enabled'],
            },
            {
                featureKey: 'quota.replay_retention_days',
                value: 7,
                dependencies: ['replay.enabled'],
            },
            {
                featureKey: 'quota.trace_retention_days',
                value: 30,
                dependencies: ['tracing.enabled'],
            },
            {
                featureKey: 'quota.audit_log_retention_days',
                value: 30,
                dependencies: ['security.audit_logs'],
            },
            {
                featureKey: 'alerting.enabled',
                value: true,
            },
            {
                featureKey: 'alerting.rules',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.routing.enabled',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.composite',
                value: false,
                dependencies: ['alerting.enabled', 'alerting.rules'],
            },
            {
                featureKey: 'alerting.escalation_policies',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.on_call',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.incident_timeline',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.managed_email_fallback',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.ai_alert',
                value: false,
                dependencies: ['alerting.enabled', 'ai.enabled'],
            },
            {
                featureKey: 'quota.alert_rules',
                value: 10,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.project_alert_rules',
                value: 5,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.alert_channels',
                value: 10,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.notification_channels',
                value: 10,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.project_notification_channels',
                value: 3,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.routing_rules',
                value: 2,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.project_routing_rules',
                value: 1,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.daily_alerts',
                value: 100,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.monthly_alerts',
                value: 1000,
                overageRate: 10,
                overageUnit: 100,
                gracePercent: 5,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.connector_sends',
                value: 1000,
                overageRate: 25,
                overageUnit: 100,
                gracePercent: 5,
            },
            {
                featureKey: 'automation.enabled',
                value: true,
            },
            {
                featureKey: 'quota.automation_rules',
                value: 5,
                dependencies: ['automation.enabled'],
            },
            {
                featureKey: 'dashboards.enabled',
                value: true,
            },
            {
                featureKey: 'dashboards.custom_dashboards',
                value: true,
                dependencies: ['dashboards.enabled'],
            },
            {
                featureKey: 'dashboards.custom_widgets',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.embeds',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.public_links',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.scheduled_reports',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.dashboards',
                value: 3,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.monthly_reports',
                value: 5,
                dependencies: ['dashboards.scheduled_reports'],
            },
            {
                featureKey: 'analytics.explorer',
                value: true,
            },
            {
                featureKey: 'analytics.query_builder',
                value: false,
                dependencies: ['analytics.explorer'],
            },
            {
                featureKey: 'ai.enabled',
                value: true,
            },
            {
                featureKey: 'ai.summaries',
                value: true,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'ai.root_cause_analysis',
                value: false,
                dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
            },
            {
                featureKey: 'ai.anomaly_detection',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.forecasting',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.incident_copilot',
                value: false,
                dependencies: ['ai.enabled', 'alerting.enabled'],
            },
            {
                featureKey: 'quota.ai_credits',
                value: 100,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'integrations.enabled',
                value: true,
            },
            {
                featureKey: 'integrations.rest_api',
                value: true,
            },
            {
                featureKey: 'quota.connectors',
                value: 10,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'quota.integrations',
                value: 10,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'integrations.email',
                value: true,
            },
            {
                featureKey: 'integrations.webhook',
                value: true,
            },
            {
                featureKey: 'integrations.slack',
                value: true,
            },
            {
                featureKey: 'integrations.discord',
                value: false,
            },
            {
                featureKey: 'integrations.microsoft_teams',
                value: false,
            },
            {
                featureKey: 'integrations.pagerduty',
                value: false,
            },
            {
                featureKey: 'integrations.sms',
                value: false,
            },
            {
                featureKey: 'integrations.github',
                value: false,
            },
            {
                featureKey: 'integrations.gitlab',
                value: false,
            },
            {
                featureKey: 'integrations.bitbucket',
                value: false,
            },
            {
                featureKey: 'integrations.jira',
                value: false,
            },
            {
                featureKey: 'integrations.terraform',
                value: false,
            },
            {
                featureKey: 'security.enabled',
                value: false,
            },
            {
                featureKey: 'security.audit_logs',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.sso',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.scim',
                value: false,
                dependencies: ['security.enabled', 'security.sso'],
            },
            {
                featureKey: 'security.custom_roles',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.service_accounts',
                value: 2,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.custom_roles',
                value: 0,
                dependencies: ['security.custom_roles'],
            },
            {
                featureKey: 'support.dedicated',
                value: false,
            },
            {
                featureKey: 'support.sla',
                value: null,
            },
            {
                featureKey: 'deployment.custom',
                value: false,
            },
            {
                featureKey: 'compliance.hipaa',
                value: false,
            },
            {
                featureKey: 'compliance.gdpr_dpa',
                value: false,
            },
        ],
    },
    'growth': {
        plan: {
            id: "seed-plan-growth",
            key: 'growth',
            name: "Growth",
            tier: 'growth',
            description: "Scaling teams requiring advanced observability and AI capabilities. One organization per user.",
            trialDays: 14,
            sortOrder: 3,
            isPublic: true,
            isCustomizable: false,
            nextPlanKey: 'business',
            badge: "Recommended",
            metadata: { "highlightedFeatures": ["ai.enabled", "alerting.composite", "dashboards.custom_widgets"], "recommendedFor": "Growing teams with complex infrastructure", "ctaText": "Start 14-Day Free Trial" },
            prices: [
                {
                    id: "seed-price-growth-monthly",
                    provider: "stripe",
                    interval: "monthly",
                    currency: "USD",
                    amountMinor: 4900,
                    isDefault: true,
                    metadata: { "display": "$49/mo", "recommended": true },
                },
                {
                    id: "seed-price-growth-annual",
                    provider: "stripe",
                    interval: "annual",
                    currency: "USD",
                    amountMinor: 49000,
                    isDefault: false,
                    metadata: { "display": "$490/year", "discount": "2 months free" },
                },
            ],
        },
        features: [
            {
                featureKey: 'organization.enabled',
                value: true,
            },
            {
                featureKey: 'organization.max_orgs_per_user',
                value: 1,
            },
            {
                featureKey: 'projects.enabled',
                value: true,
            },
            {
                featureKey: 'quota.projects',
                value: 25,
            },
            {
                featureKey: 'quota.members',
                value: 50,
            },
            {
                featureKey: 'quota.environments',
                value: 10,
            },
            {
                featureKey: 'quota.api_keys',
                value: 50,
            },
            {
                featureKey: 'quota.monthly_events',
                value: 1000000,
                overageRate: 50,
                overageUnit: 1000,
                gracePercent: 10,
            },
            {
                featureKey: 'quota.requests_per_second',
                value: 1000,
            },
            {
                featureKey: 'sdk.enabled',
                value: true,
            },
            {
                featureKey: 'sdk.remote_config',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.retry',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.batching',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.offline_queue',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.dynamic_sampling',
                value: true,
                dependencies: ['sdk.enabled', 'sdk.remote_config'],
            },
            {
                featureKey: 'quota.sdk_batch_queue_size',
                value: 10000,
                dependencies: ['sdk.batching'],
            },
            {
                featureKey: 'quota.sdk_offline_queue_limit',
                value: 5000,
                dependencies: ['sdk.offline_queue'],
            },
            {
                featureKey: 'privacy.data_scrubbing',
                value: true,
            },
            {
                featureKey: 'privacy.capture_headers',
                value: false,
            },
            {
                featureKey: 'privacy.capture_body',
                value: false,
            },
            {
                featureKey: 'privacy.capture_ip',
                value: false,
            },
            {
                featureKey: 'error_tracking.enabled',
                value: true,
            },
            {
                featureKey: 'tracing.enabled',
                value: true,
            },
            {
                featureKey: 'logging.enabled',
                value: true,
            },
            {
                featureKey: 'metrics.enabled',
                value: true,
            },
            {
                featureKey: 'profiling.enabled',
                value: true,
            },
            {
                featureKey: 'replay.enabled',
                value: true,
            },
            {
                featureKey: 'uptime.enabled',
                value: true,
            },
            {
                featureKey: 'cron_monitoring.enabled',
                value: true,
                dependencies: ['uptime.enabled'],
            },
            {
                featureKey: 'quota.retention_days',
                value: 90,
            },
            {
                featureKey: 'quota.log_retention_days',
                value: 90,
            },
            {
                featureKey: 'quota.metric_retention_days',
                value: 90,
            },
            {
                featureKey: 'quota.profile_retention_days',
                value: 90,
                dependencies: ['profiling.enabled'],
            },
            {
                featureKey: 'quota.replay_retention_days',
                value: 30,
                dependencies: ['replay.enabled'],
            },
            {
                featureKey: 'quota.trace_retention_days',
                value: 90,
                dependencies: ['tracing.enabled'],
            },
            {
                featureKey: 'quota.audit_log_retention_days',
                value: 180,
                dependencies: ['security.audit_logs'],
            },
            {
                featureKey: 'alerting.enabled',
                value: true,
            },
            {
                featureKey: 'alerting.rules',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.routing.enabled',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.composite',
                value: true,
                dependencies: ['alerting.enabled', 'alerting.rules'],
            },
            {
                featureKey: 'alerting.escalation_policies',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.on_call',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.incident_timeline',
                value: false,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.managed_email_fallback',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.ai_alert',
                value: true,
                dependencies: ['alerting.enabled', 'ai.enabled'],
            },
            {
                featureKey: 'quota.alert_rules',
                value: 50,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.project_alert_rules',
                value: 25,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.alert_channels',
                value: 50,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.notification_channels',
                value: 50,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.project_notification_channels',
                value: 10,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.routing_rules',
                value: 10,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.project_routing_rules',
                value: 5,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.daily_alerts',
                value: 1000,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.monthly_alerts',
                value: 10000,
                overageRate: 10,
                overageUnit: 100,
                gracePercent: 5,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.connector_sends',
                value: 10000,
                overageRate: 25,
                overageUnit: 100,
                gracePercent: 5,
            },
            {
                featureKey: 'automation.enabled',
                value: true,
            },
            {
                featureKey: 'quota.automation_rules',
                value: 25,
                dependencies: ['automation.enabled'],
            },
            {
                featureKey: 'dashboards.enabled',
                value: true,
            },
            {
                featureKey: 'dashboards.custom_dashboards',
                value: true,
                dependencies: ['dashboards.enabled'],
            },
            {
                featureKey: 'dashboards.custom_widgets',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.embeds',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.public_links',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.scheduled_reports',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.dashboards',
                value: 10,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.monthly_reports',
                value: 25,
                dependencies: ['dashboards.scheduled_reports'],
            },
            {
                featureKey: 'analytics.explorer',
                value: true,
            },
            {
                featureKey: 'analytics.query_builder',
                value: true,
                dependencies: ['analytics.explorer'],
            },
            {
                featureKey: 'ai.enabled',
                value: true,
            },
            {
                featureKey: 'ai.summaries',
                value: true,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'ai.root_cause_analysis',
                value: false,
                dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
            },
            {
                featureKey: 'ai.anomaly_detection',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.forecasting',
                value: false,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.incident_copilot',
                value: false,
                dependencies: ['ai.enabled', 'alerting.enabled'],
            },
            {
                featureKey: 'quota.ai_credits',
                value: 1000,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'integrations.enabled',
                value: true,
            },
            {
                featureKey: 'integrations.rest_api',
                value: true,
            },
            {
                featureKey: 'quota.connectors',
                value: 50,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'quota.integrations',
                value: 50,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'integrations.email',
                value: true,
            },
            {
                featureKey: 'integrations.webhook',
                value: true,
            },
            {
                featureKey: 'integrations.slack',
                value: true,
            },
            {
                featureKey: 'integrations.discord',
                value: true,
            },
            {
                featureKey: 'integrations.microsoft_teams',
                value: false,
            },
            {
                featureKey: 'integrations.pagerduty',
                value: false,
            },
            {
                featureKey: 'integrations.sms',
                value: false,
            },
            {
                featureKey: 'integrations.github',
                value: true,
            },
            {
                featureKey: 'integrations.gitlab',
                value: false,
            },
            {
                featureKey: 'integrations.bitbucket',
                value: false,
            },
            {
                featureKey: 'integrations.jira',
                value: true,
            },
            {
                featureKey: 'integrations.terraform',
                value: false,
            },
            {
                featureKey: 'security.enabled',
                value: false,
            },
            {
                featureKey: 'security.audit_logs',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.sso',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.scim',
                value: false,
                dependencies: ['security.enabled', 'security.sso'],
            },
            {
                featureKey: 'security.custom_roles',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.service_accounts',
                value: 10,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.custom_roles',
                value: 25,
                dependencies: ['security.custom_roles'],
            },
            {
                featureKey: 'support.dedicated',
                value: false,
            },
            {
                featureKey: 'support.sla',
                value: null,
            },
            {
                featureKey: 'deployment.custom',
                value: false,
            },
            {
                featureKey: 'compliance.hipaa',
                value: false,
            },
            {
                featureKey: 'compliance.gdpr_dpa',
                value: false,
            },
        ],
    },
    'business': {
        plan: {
            id: "seed-plan-business",
            key: 'business',
            name: "Business",
            tier: 'business',
            description: "Enterprise-ready monitoring with governance, security and automation. One organization per user.",
            trialDays: 14,
            sortOrder: 4,
            isPublic: true,
            isCustomizable: false,
            nextPlanKey: 'enterprise',
            badge: "Best Value",
            metadata: { "highlightedFeatures": ["security.enabled", "ai.root_cause_analysis", "alerting.on_call"], "recommendedFor": "Businesses requiring compliance and governance", "ctaText": "Start 14-Day Free Trial" },
            prices: [
                {
                    id: "seed-price-business-monthly",
                    provider: "stripe",
                    interval: "monthly",
                    currency: "USD",
                    amountMinor: 14900,
                    isDefault: true,
                    metadata: { "display": "$149/mo", "recommended": false },
                },
                {
                    id: "seed-price-business-annual",
                    provider: "stripe",
                    interval: "annual",
                    currency: "USD",
                    amountMinor: 149000,
                    isDefault: false,
                    metadata: { "display": "$1490/year", "discount": "2 months free" },
                },
            ],
        },
        features: [
            {
                featureKey: 'organization.enabled',
                value: true,
            },
            {
                featureKey: 'organization.max_orgs_per_user',
                value: 1,
            },
            {
                featureKey: 'projects.enabled',
                value: true,
            },
            {
                featureKey: 'quota.projects',
                value: 100,
            },
            {
                featureKey: 'quota.members',
                value: 250,
            },
            {
                featureKey: 'quota.environments',
                value: 25,
            },
            {
                featureKey: 'quota.api_keys',
                value: 250,
            },
            {
                featureKey: 'quota.monthly_events',
                value: 8000000,
                overageRate: 50,
                overageUnit: 1000,
                gracePercent: 10,
            },
            {
                featureKey: 'quota.requests_per_second',
                value: 5000,
            },
            {
                featureKey: 'sdk.enabled',
                value: true,
            },
            {
                featureKey: 'sdk.remote_config',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.retry',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.batching',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.offline_queue',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.dynamic_sampling',
                value: true,
                dependencies: ['sdk.enabled', 'sdk.remote_config'],
            },
            {
                featureKey: 'quota.sdk_batch_queue_size',
                value: 50000,
                dependencies: ['sdk.batching'],
            },
            {
                featureKey: 'quota.sdk_offline_queue_limit',
                value: 25000,
                dependencies: ['sdk.offline_queue'],
            },
            {
                featureKey: 'privacy.data_scrubbing',
                value: true,
            },
            {
                featureKey: 'privacy.capture_headers',
                value: true,
            },
            {
                featureKey: 'privacy.capture_body',
                value: true,
            },
            {
                featureKey: 'privacy.capture_ip',
                value: false,
            },
            {
                featureKey: 'error_tracking.enabled',
                value: true,
            },
            {
                featureKey: 'tracing.enabled',
                value: true,
            },
            {
                featureKey: 'logging.enabled',
                value: true,
            },
            {
                featureKey: 'metrics.enabled',
                value: true,
            },
            {
                featureKey: 'profiling.enabled',
                value: true,
            },
            {
                featureKey: 'replay.enabled',
                value: true,
            },
            {
                featureKey: 'uptime.enabled',
                value: true,
            },
            {
                featureKey: 'cron_monitoring.enabled',
                value: true,
                dependencies: ['uptime.enabled'],
            },
            {
                featureKey: 'quota.retention_days',
                value: 180,
            },
            {
                featureKey: 'quota.log_retention_days',
                value: 180,
            },
            {
                featureKey: 'quota.metric_retention_days',
                value: 180,
            },
            {
                featureKey: 'quota.profile_retention_days',
                value: 180,
                dependencies: ['profiling.enabled'],
            },
            {
                featureKey: 'quota.replay_retention_days',
                value: 90,
                dependencies: ['replay.enabled'],
            },
            {
                featureKey: 'quota.trace_retention_days',
                value: 180,
                dependencies: ['tracing.enabled'],
            },
            {
                featureKey: 'quota.audit_log_retention_days',
                value: 365,
                dependencies: ['security.audit_logs'],
            },
            {
                featureKey: 'alerting.enabled',
                value: true,
            },
            {
                featureKey: 'alerting.rules',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.routing.enabled',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.composite',
                value: true,
                dependencies: ['alerting.enabled', 'alerting.rules'],
            },
            {
                featureKey: 'alerting.escalation_policies',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.on_call',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.incident_timeline',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.managed_email_fallback',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.ai_alert',
                value: true,
                dependencies: ['alerting.enabled', 'ai.enabled'],
            },
            {
                featureKey: 'quota.alert_rules',
                value: 250,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.project_alert_rules',
                value: 100,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.alert_channels',
                value: 250,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.notification_channels',
                value: 250,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.project_notification_channels',
                value: 50,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.routing_rules',
                value: 50,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.project_routing_rules',
                value: 25,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.daily_alerts',
                value: 10000,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.monthly_alerts',
                value: 100000,
                overageRate: 10,
                overageUnit: 100,
                gracePercent: 5,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.connector_sends',
                value: 100000,
                overageRate: 25,
                overageUnit: 100,
                gracePercent: 5,
            },
            {
                featureKey: 'automation.enabled',
                value: true,
            },
            {
                featureKey: 'quota.automation_rules',
                value: 100,
                dependencies: ['automation.enabled'],
            },
            {
                featureKey: 'dashboards.enabled',
                value: true,
            },
            {
                featureKey: 'dashboards.custom_dashboards',
                value: true,
                dependencies: ['dashboards.enabled'],
            },
            {
                featureKey: 'dashboards.custom_widgets',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.embeds',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.public_links',
                value: false,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.scheduled_reports',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.dashboards',
                value: 25,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.monthly_reports',
                value: 100,
                dependencies: ['dashboards.scheduled_reports'],
            },
            {
                featureKey: 'analytics.explorer',
                value: true,
            },
            {
                featureKey: 'analytics.query_builder',
                value: true,
                dependencies: ['analytics.explorer'],
            },
            {
                featureKey: 'ai.enabled',
                value: true,
            },
            {
                featureKey: 'ai.summaries',
                value: true,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'ai.root_cause_analysis',
                value: true,
                dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
            },
            {
                featureKey: 'ai.anomaly_detection',
                value: true,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.forecasting',
                value: true,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.incident_copilot',
                value: false,
                dependencies: ['ai.enabled', 'alerting.enabled'],
            },
            {
                featureKey: 'quota.ai_credits',
                value: 5000,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'integrations.enabled',
                value: true,
            },
            {
                featureKey: 'integrations.rest_api',
                value: true,
            },
            {
                featureKey: 'quota.connectors',
                value: 250,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'quota.integrations',
                value: 250,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'integrations.email',
                value: true,
            },
            {
                featureKey: 'integrations.webhook',
                value: true,
            },
            {
                featureKey: 'integrations.slack',
                value: true,
            },
            {
                featureKey: 'integrations.discord',
                value: true,
            },
            {
                featureKey: 'integrations.microsoft_teams',
                value: false,
            },
            {
                featureKey: 'integrations.pagerduty',
                value: true,
            },
            {
                featureKey: 'integrations.sms',
                value: true,
            },
            {
                featureKey: 'integrations.github',
                value: true,
            },
            {
                featureKey: 'integrations.gitlab',
                value: true,
            },
            {
                featureKey: 'integrations.bitbucket',
                value: false,
            },
            {
                featureKey: 'integrations.jira',
                value: true,
            },
            {
                featureKey: 'integrations.terraform',
                value: true,
            },
            {
                featureKey: 'security.enabled',
                value: true,
            },
            {
                featureKey: 'security.audit_logs',
                value: true,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.sso',
                value: true,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.scim',
                value: false,
                dependencies: ['security.enabled', 'security.sso'],
            },
            {
                featureKey: 'security.custom_roles',
                value: false,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.service_accounts',
                value: 100,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.custom_roles',
                value: 100,
                dependencies: ['security.custom_roles'],
            },
            {
                featureKey: 'support.dedicated',
                value: true,
            },
            {
                featureKey: 'support.sla',
                value: "99.9%",
            },
            {
                featureKey: 'deployment.custom',
                value: false,
            },
            {
                featureKey: 'compliance.hipaa',
                value: false,
            },
            {
                featureKey: 'compliance.gdpr_dpa',
                value: true,
            },
        ],
    },
    'enterprise': {
        plan: {
            id: "seed-plan-enterprise",
            key: 'enterprise',
            name: "Enterprise",
            tier: 'enterprise',
            description: "Custom enterprise deployment with unlimited scale and dedicated support. One organization per user.",
            trialDays: 30,
            sortOrder: 5,
            isPublic: false,
            isCustomizable: true,
            nextPlanKey: null,
            badge: null,
            metadata: { "highlightedFeatures": ["deployment.custom", "compliance.hipaa", "ai.incident_copilot"], "recommendedFor": "Large enterprises with custom requirements", "ctaText": "Contact Sales" },
            prices: [
                {
                    id: "seed-price-enterprise-monthly",
                    provider: "system",
                    interval: "monthly",
                    currency: "USD",
                    amountMinor: 0,
                    isDefault: true,
                    metadata: { "display": "Contact Sales", "contactSales": true },
                },
                {
                    id: "seed-price-enterprise-annual",
                    provider: "system",
                    interval: "annual",
                    currency: "USD",
                    amountMinor: 0,
                    isDefault: false,
                    metadata: { "display": "Contact Sales", "contactSales": true },
                },
            ],
        },
        features: [
            {
                featureKey: 'organization.enabled',
                value: true,
            },
            {
                featureKey: 'organization.max_orgs_per_user',
                value: 1,
            },
            {
                featureKey: 'projects.enabled',
                value: true,
            },
            {
                featureKey: 'quota.projects',
                value: 1000,
            },
            {
                featureKey: 'quota.members',
                value: 10000,
            },
            {
                featureKey: 'quota.environments',
                value: 100,
            },
            {
                featureKey: 'quota.api_keys',
                value: 1000,
            },
            {
                featureKey: 'quota.monthly_events',
                value: 'Custom',
                overageRate: 50,
                overageUnit: 1000,
                gracePercent: 10,
            },
            {
                featureKey: 'quota.requests_per_second',
                value: 50000,
            },
            {
                featureKey: 'sdk.enabled',
                value: true,
            },
            {
                featureKey: 'sdk.remote_config',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.retry',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.batching',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.offline_queue',
                value: true,
                dependencies: ['sdk.enabled'],
            },
            {
                featureKey: 'sdk.dynamic_sampling',
                value: true,
                dependencies: ['sdk.enabled', 'sdk.remote_config'],
            },
            {
                featureKey: 'quota.sdk_batch_queue_size',
                value: 100000,
                dependencies: ['sdk.batching'],
            },
            {
                featureKey: 'quota.sdk_offline_queue_limit',
                value: 100000,
                dependencies: ['sdk.offline_queue'],
            },
            {
                featureKey: 'privacy.data_scrubbing',
                value: true,
            },
            {
                featureKey: 'privacy.capture_headers',
                value: true,
            },
            {
                featureKey: 'privacy.capture_body',
                value: true,
            },
            {
                featureKey: 'privacy.capture_ip',
                value: true,
            },
            {
                featureKey: 'error_tracking.enabled',
                value: true,
            },
            {
                featureKey: 'tracing.enabled',
                value: true,
            },
            {
                featureKey: 'logging.enabled',
                value: true,
            },
            {
                featureKey: 'metrics.enabled',
                value: true,
            },
            {
                featureKey: 'profiling.enabled',
                value: true,
            },
            {
                featureKey: 'replay.enabled',
                value: true,
            },
            {
                featureKey: 'uptime.enabled',
                value: true,
            },
            {
                featureKey: 'cron_monitoring.enabled',
                value: true,
                dependencies: ['uptime.enabled'],
            },
            {
                featureKey: 'quota.retention_days',
                value: 365,
            },
            {
                featureKey: 'quota.log_retention_days',
                value: 365,
            },
            {
                featureKey: 'quota.metric_retention_days',
                value: 365,
            },
            {
                featureKey: 'quota.profile_retention_days',
                value: 365,
                dependencies: ['profiling.enabled'],
            },
            {
                featureKey: 'quota.replay_retention_days',
                value: 365,
                dependencies: ['replay.enabled'],
            },
            {
                featureKey: 'quota.trace_retention_days',
                value: 365,
                dependencies: ['tracing.enabled'],
            },
            {
                featureKey: 'quota.audit_log_retention_days',
                value: 2555,
                dependencies: ['security.audit_logs'],
            },
            {
                featureKey: 'alerting.enabled',
                value: true,
            },
            {
                featureKey: 'alerting.rules',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.routing.enabled',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.composite',
                value: true,
                dependencies: ['alerting.enabled', 'alerting.rules'],
            },
            {
                featureKey: 'alerting.escalation_policies',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.on_call',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.incident_timeline',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.managed_email_fallback',
                value: true,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'alerting.ai_alert',
                value: true,
                dependencies: ['alerting.enabled', 'ai.enabled'],
            },
            {
                featureKey: 'quota.alert_rules',
                value: 1000,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.project_alert_rules',
                value: 500,
                dependencies: ['alerting.rules'],
            },
            {
                featureKey: 'quota.alert_channels',
                value: 1000,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.notification_channels',
                value: 1000,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.project_notification_channels',
                value: 250,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.routing_rules',
                value: 200,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.project_routing_rules',
                value: 100,
                dependencies: ['alerting.routing.enabled'],
            },
            {
                featureKey: 'quota.daily_alerts',
                value: 100000,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.monthly_alerts',
                value: 1000000,
                overageRate: 10,
                overageUnit: 100,
                gracePercent: 5,
                dependencies: ['alerting.enabled'],
            },
            {
                featureKey: 'quota.connector_sends',
                value: 1000000,
                overageRate: 25,
                overageUnit: 100,
                gracePercent: 5,
            },
            {
                featureKey: 'automation.enabled',
                value: true,
            },
            {
                featureKey: 'quota.automation_rules',
                value: 1000,
                dependencies: ['automation.enabled'],
            },
            {
                featureKey: 'dashboards.enabled',
                value: true,
            },
            {
                featureKey: 'dashboards.custom_dashboards',
                value: true,
                dependencies: ['dashboards.enabled'],
            },
            {
                featureKey: 'dashboards.custom_widgets',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.embeds',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.public_links',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'dashboards.scheduled_reports',
                value: true,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.dashboards',
                value: 1000,
                dependencies: ['dashboards.custom_dashboards'],
            },
            {
                featureKey: 'quota.monthly_reports',
                value: 1000,
                dependencies: ['dashboards.scheduled_reports'],
            },
            {
                featureKey: 'analytics.explorer',
                value: true,
            },
            {
                featureKey: 'analytics.query_builder',
                value: true,
                dependencies: ['analytics.explorer'],
            },
            {
                featureKey: 'ai.enabled',
                value: true,
            },
            {
                featureKey: 'ai.summaries',
                value: true,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'ai.root_cause_analysis',
                value: true,
                dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
            },
            {
                featureKey: 'ai.anomaly_detection',
                value: true,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.forecasting',
                value: true,
                dependencies: ['ai.enabled', 'metrics.enabled'],
            },
            {
                featureKey: 'ai.incident_copilot',
                value: true,
                dependencies: ['ai.enabled', 'alerting.enabled'],
            },
            {
                featureKey: 'quota.ai_credits',
                value: 50000,
                dependencies: ['ai.enabled'],
            },
            {
                featureKey: 'integrations.enabled',
                value: true,
            },
            {
                featureKey: 'integrations.rest_api',
                value: true,
            },
            {
                featureKey: 'quota.connectors',
                value: 1000,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'quota.integrations',
                value: 1000,
                dependencies: ['integrations.enabled'],
            },
            {
                featureKey: 'integrations.email',
                value: true,
            },
            {
                featureKey: 'integrations.webhook',
                value: true,
            },
            {
                featureKey: 'integrations.slack',
                value: true,
            },
            {
                featureKey: 'integrations.discord',
                value: true,
            },
            {
                featureKey: 'integrations.microsoft_teams',
                value: true,
            },
            {
                featureKey: 'integrations.pagerduty',
                value: true,
            },
            {
                featureKey: 'integrations.sms',
                value: true,
            },
            {
                featureKey: 'integrations.github',
                value: true,
            },
            {
                featureKey: 'integrations.gitlab',
                value: true,
            },
            {
                featureKey: 'integrations.bitbucket',
                value: true,
            },
            {
                featureKey: 'integrations.jira',
                value: true,
            },
            {
                featureKey: 'integrations.terraform',
                value: true,
            },
            {
                featureKey: 'security.enabled',
                value: true,
            },
            {
                featureKey: 'security.audit_logs',
                value: true,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.sso',
                value: true,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'security.scim',
                value: true,
                dependencies: ['security.enabled', 'security.sso'],
            },
            {
                featureKey: 'security.custom_roles',
                value: true,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.service_accounts',
                value: 1000,
                dependencies: ['security.enabled'],
            },
            {
                featureKey: 'quota.custom_roles',
                value: 1000,
                dependencies: ['security.custom_roles'],
            },
            {
                featureKey: 'support.dedicated',
                value: true,
            },
            {
                featureKey: 'support.sla',
                value: "99.99%",
            },
            {
                featureKey: 'deployment.custom',
                value: true,
            },
            {
                featureKey: 'compliance.hipaa',
                value: true,
            },
            {
                featureKey: 'compliance.gdpr_dpa',
                value: true,
            },
        ],
    },
};
export const CANONICAL_PLAN_MATRIX = PLAN_MATRIX;
/**
 * Returns all feature values configured for a plan.
 */
export function getPlanFeatures(planKey) {
    const entry = PLAN_MATRIX[planKey];
    if (!entry) {
        throw new PlanNotFoundError(planKey);
    }
    return [...entry.features];
}
/**
 * Returns the configured entitlement value for a specific plan and feature.
 */
export function getFeatureValue(planKey, featureKey) {
    const features = getPlanFeatures(planKey);
    return features.find(f => f.featureKey === featureKey);
}
/**
 * Checks if a boolean feature is enabled (true) on a plan.
 */
export function isFeatureEnabled(planKey, featureKey) {
    const feat = getFeatureValue(planKey, featureKey);
    return feat?.value === true;
}
/**
 * Returns the integer numeric quota value for a feature on a plan, if defined.
 * If value is -1 (unlimited) or an integer, it returns that number.
 */
export function getQuotaValue(planKey, featureKey) {
    const feat = getFeatureValue(planKey, featureKey);
    if (typeof feat?.value === 'number') {
        return feat.value;
    }
    return undefined;
}
/**
 * Compares two plans and returns array of feature keys whose values/limits differ.
 */
export function comparePlans(from, to) {
    const fromFeatures = getPlanFeatures(from);
    const toFeaturesMap = new Map(getPlanFeatures(to).map(f => [f.featureKey, f]));
    const differences = [];
    for (const fromFeat of fromFeatures) {
        const toFeat = toFeaturesMap.get(fromFeat.featureKey);
        if (!toFeat) {
            differences.push(fromFeat.featureKey);
            continue;
        }
        if (fromFeat.value !== toFeat.value ||
            fromFeat.overageRate !== toFeat.overageRate ||
            fromFeat.overageUnit !== toFeat.overageUnit ||
            fromFeat.gracePercent !== toFeat.gracePercent) {
            differences.push(fromFeat.featureKey);
        }
    }
    return differences;
}
//# sourceMappingURL=plan-matrix.js.map