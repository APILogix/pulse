/**
 * Plan-to-Feature Entitlement Matrix
 *
 * Defines plan metadata and entitlement values for all 5 platform plans.
 * Auto-generated from catalog version 2.0.
 */

import type { FeatureKey, PlanKey } from './feature-registry.js';

export type { PlanKey };

export interface PlanPrice {
  readonly id: string;
  readonly provider: 'stripe' | 'system' | string;
  readonly interval: 'monthly' | 'annual' | string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly isDefault: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PlanDefinition {
  readonly id: string;
  readonly key: PlanKey;
  readonly name: string;
  readonly tier: PlanKey;
  readonly description: string;
  readonly trialDays: number;
  readonly sortOrder: number;
  readonly isPublic: boolean;
  readonly isCustomizable: boolean;
  readonly nextPlanKey: PlanKey | null;
  readonly badge: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly prices: readonly PlanPrice[];
}

export interface PlanFeatureValue {
  readonly featureKey: FeatureKey;
  readonly value: boolean | number | string | null;
  readonly overageRate?: number;
  readonly overageUnit?: number;
  readonly gracePercent?: number;
  readonly dependencies?: readonly FeatureKey[];
}

export class PlanNotFoundError extends Error {
  constructor(public readonly planKey: string) {
    super(`Plan '${planKey}' is not defined in the plan matrix.`);
    this.name = 'PlanNotFoundError';
  }
}

/**
 * Authoritative Plan Entitlement Matrix mapping each plan to its 102 feature values.
 */
export const PLAN_MATRIX: Readonly<Record<PlanKey, { readonly plan: PlanDefinition; readonly features: readonly PlanFeatureValue[] }>> = {
  'free': {
    plan: {
      id: "seed-plan-free",
      key: 'free' as PlanKey,
      name: "Free",
      tier: 'free' as PlanKey,
      description: "Perfect for personal projects, prototypes and evaluation. One organization per user.",
      trialDays: 0,
      sortOrder: 1,
      isPublic: true,
      isCustomizable: false,
      nextPlanKey: 'starter' as PlanKey,
      badge: null,
      metadata: {"highlightedFeatures":["error_tracking.enabled","tracing.enabled","logging.enabled"],"recommendedFor":"Individual developers and hobby projects","ctaText":"Get Started Free"},
      prices: [
        {
          id: "seed-price-free-monthly",
          provider: "stripe",
          interval: "monthly",
          currency: "USD",
          amountMinor: 0,
          isDefault: true,
          metadata: {"display":"$0/mo","recommended":false},
        },
        {
          id: "seed-price-free-annual",
          provider: "stripe",
          interval: "annual",
          currency: "USD",
          amountMinor: 0,
          isDefault: false,
          metadata: {"display":"$0/year","discount":"2 months free"},
        },
      ],
    },
    features: [
      {
        featureKey: 'organization.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'organization.max_orgs_per_user' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'projects.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.projects' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'quota.members' as FeatureKey,
        value: 3,
      },
      {
        featureKey: 'quota.environments' as FeatureKey,
        value: 2,
      },
      {
        featureKey: 'quota.api_keys' as FeatureKey,
        value: 2,
      },
      {
        featureKey: 'quota.monthly_events' as FeatureKey,
        value: 10000,
        overageRate: 50,
        overageUnit: 1000,
        gracePercent: 10,
      },
      {
        featureKey: 'quota.requests_per_second' as FeatureKey,
        value: 50,
      },
      {
        featureKey: 'sdk.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'sdk.remote_config' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.retry' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.batching' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.offline_queue' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.dynamic_sampling' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled', 'sdk.remote_config'],
      },
      {
        featureKey: 'quota.sdk_batch_queue_size' as FeatureKey,
        value: 0,
        dependencies: ['sdk.batching'],
      },
      {
        featureKey: 'quota.sdk_offline_queue_limit' as FeatureKey,
        value: 0,
        dependencies: ['sdk.offline_queue'],
      },
      {
        featureKey: 'privacy.data_scrubbing' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_headers' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_body' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_ip' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'error_tracking.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'tracing.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'logging.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'metrics.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'profiling.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'replay.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'uptime.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'cron_monitoring.enabled' as FeatureKey,
        value: false,
        dependencies: ['uptime.enabled'],
      },
      {
        featureKey: 'quota.retention_days' as FeatureKey,
        value: 7,
      },
      {
        featureKey: 'quota.log_retention_days' as FeatureKey,
        value: 7,
      },
      {
        featureKey: 'quota.metric_retention_days' as FeatureKey,
        value: 7,
      },
      {
        featureKey: 'quota.profile_retention_days' as FeatureKey,
        value: 0,
        dependencies: ['profiling.enabled'],
      },
      {
        featureKey: 'quota.replay_retention_days' as FeatureKey,
        value: 0,
        dependencies: ['replay.enabled'],
      },
      {
        featureKey: 'quota.trace_retention_days' as FeatureKey,
        value: 7,
        dependencies: ['tracing.enabled'],
      },
      {
        featureKey: 'quota.audit_log_retention_days' as FeatureKey,
        value: 0,
        dependencies: ['security.audit_logs'],
      },
      {
        featureKey: 'alerting.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'alerting.rules' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.routing.enabled' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.composite' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled', 'alerting.rules'],
      },
      {
        featureKey: 'alerting.escalation_policies' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.on_call' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.incident_timeline' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.managed_email_fallback' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.ai_alert' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled', 'ai.enabled'],
      },
      {
        featureKey: 'quota.alert_rules' as FeatureKey,
        value: 0,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.project_alert_rules' as FeatureKey,
        value: 0,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.alert_channels' as FeatureKey,
        value: 0,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.notification_channels' as FeatureKey,
        value: 0,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.project_notification_channels' as FeatureKey,
        value: 0,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.routing_rules' as FeatureKey,
        value: 0,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.project_routing_rules' as FeatureKey,
        value: 0,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.daily_alerts' as FeatureKey,
        value: 10,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.monthly_alerts' as FeatureKey,
        value: 100,
        overageRate: 10,
        overageUnit: 100,
        gracePercent: 5,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.connector_sends' as FeatureKey,
        value: 0,
        overageRate: 25,
        overageUnit: 100,
        gracePercent: 5,
      },
      {
        featureKey: 'automation.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'quota.automation_rules' as FeatureKey,
        value: 0,
        dependencies: ['automation.enabled'],
      },
      {
        featureKey: 'dashboards.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'dashboards.custom_dashboards' as FeatureKey,
        value: false,
        dependencies: ['dashboards.enabled'],
      },
      {
        featureKey: 'dashboards.custom_widgets' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.embeds' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.public_links' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.scheduled_reports' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.dashboards' as FeatureKey,
        value: 1,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.monthly_reports' as FeatureKey,
        value: 0,
        dependencies: ['dashboards.scheduled_reports'],
      },
      {
        featureKey: 'analytics.explorer' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'analytics.query_builder' as FeatureKey,
        value: false,
        dependencies: ['analytics.explorer'],
      },
      {
        featureKey: 'ai.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'ai.summaries' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'ai.root_cause_analysis' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
      },
      {
        featureKey: 'ai.anomaly_detection' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.forecasting' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.incident_copilot' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'alerting.enabled'],
      },
      {
        featureKey: 'quota.ai_credits' as FeatureKey,
        value: 0,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'integrations.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.rest_api' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.connectors' as FeatureKey,
        value: 2,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'quota.integrations' as FeatureKey,
        value: 2,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'integrations.email' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.webhook' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.slack' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.discord' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.microsoft_teams' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.pagerduty' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.sms' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.github' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.gitlab' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.bitbucket' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.jira' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.terraform' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.audit_logs' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.sso' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.scim' as FeatureKey,
        value: false,
        dependencies: ['security.enabled', 'security.sso'],
      },
      {
        featureKey: 'security.custom_roles' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.service_accounts' as FeatureKey,
        value: 0,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.custom_roles' as FeatureKey,
        value: 0,
        dependencies: ['security.custom_roles'],
      },
      {
        featureKey: 'support.dedicated' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'support.sla' as FeatureKey,
        value: null,
      },
      {
        featureKey: 'deployment.custom' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.hipaa' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.gdpr_dpa' as FeatureKey,
        value: false,
      },
    ],
  },
  'starter': {
    plan: {
      id: "seed-plan-starter",
      key: 'starter' as PlanKey,
      name: "Starter",
      tier: 'starter' as PlanKey,
      description: "Production-ready observability for small teams. One organization per user.",
      trialDays: 14,
      sortOrder: 2,
      isPublic: true,
      isCustomizable: false,
      nextPlanKey: 'growth' as PlanKey,
      badge: "Popular",
      metadata: {"highlightedFeatures":["alerting.rules","dashboards.custom_dashboards","sdk.batching"],"recommendedFor":"Small teams shipping to production","ctaText":"Start 14-Day Free Trial"},
      prices: [
        {
          id: "seed-price-starter-monthly",
          provider: "stripe",
          interval: "monthly",
          currency: "USD",
          amountMinor: 1500,
          isDefault: true,
          metadata: {"display":"$15/mo","recommended":false},
        },
        {
          id: "seed-price-starter-annual",
          provider: "stripe",
          interval: "annual",
          currency: "USD",
          amountMinor: 15000,
          isDefault: false,
          metadata: {"display":"$150/year","discount":"2 months free"},
        },
      ],
    },
    features: [
      {
        featureKey: 'organization.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'organization.max_orgs_per_user' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'projects.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.projects' as FeatureKey,
        value: 5,
      },
      {
        featureKey: 'quota.members' as FeatureKey,
        value: 10,
      },
      {
        featureKey: 'quota.environments' as FeatureKey,
        value: 5,
      },
      {
        featureKey: 'quota.api_keys' as FeatureKey,
        value: 10,
      },
      {
        featureKey: 'quota.monthly_events' as FeatureKey,
        value: 150000,
        overageRate: 50,
        overageUnit: 1000,
        gracePercent: 10,
      },
      {
        featureKey: 'quota.requests_per_second' as FeatureKey,
        value: 250,
      },
      {
        featureKey: 'sdk.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'sdk.remote_config' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.retry' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.batching' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.offline_queue' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.dynamic_sampling' as FeatureKey,
        value: false,
        dependencies: ['sdk.enabled', 'sdk.remote_config'],
      },
      {
        featureKey: 'quota.sdk_batch_queue_size' as FeatureKey,
        value: 1000,
        dependencies: ['sdk.batching'],
      },
      {
        featureKey: 'quota.sdk_offline_queue_limit' as FeatureKey,
        value: 0,
        dependencies: ['sdk.offline_queue'],
      },
      {
        featureKey: 'privacy.data_scrubbing' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_headers' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_body' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_ip' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'error_tracking.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'tracing.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'logging.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'metrics.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'profiling.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'replay.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'uptime.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'cron_monitoring.enabled' as FeatureKey,
        value: true,
        dependencies: ['uptime.enabled'],
      },
      {
        featureKey: 'quota.retention_days' as FeatureKey,
        value: 30,
      },
      {
        featureKey: 'quota.log_retention_days' as FeatureKey,
        value: 30,
      },
      {
        featureKey: 'quota.metric_retention_days' as FeatureKey,
        value: 30,
      },
      {
        featureKey: 'quota.profile_retention_days' as FeatureKey,
        value: 0,
        dependencies: ['profiling.enabled'],
      },
      {
        featureKey: 'quota.replay_retention_days' as FeatureKey,
        value: 7,
        dependencies: ['replay.enabled'],
      },
      {
        featureKey: 'quota.trace_retention_days' as FeatureKey,
        value: 30,
        dependencies: ['tracing.enabled'],
      },
      {
        featureKey: 'quota.audit_log_retention_days' as FeatureKey,
        value: 30,
        dependencies: ['security.audit_logs'],
      },
      {
        featureKey: 'alerting.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'alerting.rules' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.routing.enabled' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.composite' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled', 'alerting.rules'],
      },
      {
        featureKey: 'alerting.escalation_policies' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.on_call' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.incident_timeline' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.managed_email_fallback' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.ai_alert' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled', 'ai.enabled'],
      },
      {
        featureKey: 'quota.alert_rules' as FeatureKey,
        value: 10,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.project_alert_rules' as FeatureKey,
        value: 5,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.alert_channels' as FeatureKey,
        value: 10,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.notification_channels' as FeatureKey,
        value: 10,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.project_notification_channels' as FeatureKey,
        value: 3,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.routing_rules' as FeatureKey,
        value: 2,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.project_routing_rules' as FeatureKey,
        value: 1,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.daily_alerts' as FeatureKey,
        value: 100,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.monthly_alerts' as FeatureKey,
        value: 1000,
        overageRate: 10,
        overageUnit: 100,
        gracePercent: 5,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.connector_sends' as FeatureKey,
        value: 1000,
        overageRate: 25,
        overageUnit: 100,
        gracePercent: 5,
      },
      {
        featureKey: 'automation.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.automation_rules' as FeatureKey,
        value: 5,
        dependencies: ['automation.enabled'],
      },
      {
        featureKey: 'dashboards.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'dashboards.custom_dashboards' as FeatureKey,
        value: true,
        dependencies: ['dashboards.enabled'],
      },
      {
        featureKey: 'dashboards.custom_widgets' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.embeds' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.public_links' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.scheduled_reports' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.dashboards' as FeatureKey,
        value: 3,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.monthly_reports' as FeatureKey,
        value: 5,
        dependencies: ['dashboards.scheduled_reports'],
      },
      {
        featureKey: 'analytics.explorer' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'analytics.query_builder' as FeatureKey,
        value: false,
        dependencies: ['analytics.explorer'],
      },
      {
        featureKey: 'ai.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'ai.summaries' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'ai.root_cause_analysis' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
      },
      {
        featureKey: 'ai.anomaly_detection' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.forecasting' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.incident_copilot' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'alerting.enabled'],
      },
      {
        featureKey: 'quota.ai_credits' as FeatureKey,
        value: 100,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'integrations.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.rest_api' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.connectors' as FeatureKey,
        value: 10,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'quota.integrations' as FeatureKey,
        value: 10,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'integrations.email' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.webhook' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.slack' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.discord' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.microsoft_teams' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.pagerduty' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.sms' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.github' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.gitlab' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.bitbucket' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.jira' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.terraform' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.audit_logs' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.sso' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.scim' as FeatureKey,
        value: false,
        dependencies: ['security.enabled', 'security.sso'],
      },
      {
        featureKey: 'security.custom_roles' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.service_accounts' as FeatureKey,
        value: 2,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.custom_roles' as FeatureKey,
        value: 0,
        dependencies: ['security.custom_roles'],
      },
      {
        featureKey: 'support.dedicated' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'support.sla' as FeatureKey,
        value: null,
      },
      {
        featureKey: 'deployment.custom' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.hipaa' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.gdpr_dpa' as FeatureKey,
        value: false,
      },
    ],
  },
  'growth': {
    plan: {
      id: "seed-plan-growth",
      key: 'growth' as PlanKey,
      name: "Growth",
      tier: 'growth' as PlanKey,
      description: "Scaling teams requiring advanced observability and AI capabilities. One organization per user.",
      trialDays: 14,
      sortOrder: 3,
      isPublic: true,
      isCustomizable: false,
      nextPlanKey: 'business' as PlanKey,
      badge: "Recommended",
      metadata: {"highlightedFeatures":["ai.enabled","alerting.composite","dashboards.custom_widgets"],"recommendedFor":"Growing teams with complex infrastructure","ctaText":"Start 14-Day Free Trial"},
      prices: [
        {
          id: "seed-price-growth-monthly",
          provider: "stripe",
          interval: "monthly",
          currency: "USD",
          amountMinor: 4900,
          isDefault: true,
          metadata: {"display":"$49/mo","recommended":true},
        },
        {
          id: "seed-price-growth-annual",
          provider: "stripe",
          interval: "annual",
          currency: "USD",
          amountMinor: 49000,
          isDefault: false,
          metadata: {"display":"$490/year","discount":"2 months free"},
        },
      ],
    },
    features: [
      {
        featureKey: 'organization.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'organization.max_orgs_per_user' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'projects.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.projects' as FeatureKey,
        value: 25,
      },
      {
        featureKey: 'quota.members' as FeatureKey,
        value: 50,
      },
      {
        featureKey: 'quota.environments' as FeatureKey,
        value: 10,
      },
      {
        featureKey: 'quota.api_keys' as FeatureKey,
        value: 50,
      },
      {
        featureKey: 'quota.monthly_events' as FeatureKey,
        value: 1000000,
        overageRate: 50,
        overageUnit: 1000,
        gracePercent: 10,
      },
      {
        featureKey: 'quota.requests_per_second' as FeatureKey,
        value: 1000,
      },
      {
        featureKey: 'sdk.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'sdk.remote_config' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.retry' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.batching' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.offline_queue' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.dynamic_sampling' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled', 'sdk.remote_config'],
      },
      {
        featureKey: 'quota.sdk_batch_queue_size' as FeatureKey,
        value: 10000,
        dependencies: ['sdk.batching'],
      },
      {
        featureKey: 'quota.sdk_offline_queue_limit' as FeatureKey,
        value: 5000,
        dependencies: ['sdk.offline_queue'],
      },
      {
        featureKey: 'privacy.data_scrubbing' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_headers' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_body' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'privacy.capture_ip' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'error_tracking.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'tracing.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'logging.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'metrics.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'profiling.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'replay.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'uptime.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'cron_monitoring.enabled' as FeatureKey,
        value: true,
        dependencies: ['uptime.enabled'],
      },
      {
        featureKey: 'quota.retention_days' as FeatureKey,
        value: 90,
      },
      {
        featureKey: 'quota.log_retention_days' as FeatureKey,
        value: 90,
      },
      {
        featureKey: 'quota.metric_retention_days' as FeatureKey,
        value: 90,
      },
      {
        featureKey: 'quota.profile_retention_days' as FeatureKey,
        value: 90,
        dependencies: ['profiling.enabled'],
      },
      {
        featureKey: 'quota.replay_retention_days' as FeatureKey,
        value: 30,
        dependencies: ['replay.enabled'],
      },
      {
        featureKey: 'quota.trace_retention_days' as FeatureKey,
        value: 90,
        dependencies: ['tracing.enabled'],
      },
      {
        featureKey: 'quota.audit_log_retention_days' as FeatureKey,
        value: 180,
        dependencies: ['security.audit_logs'],
      },
      {
        featureKey: 'alerting.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'alerting.rules' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.routing.enabled' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.composite' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'alerting.rules'],
      },
      {
        featureKey: 'alerting.escalation_policies' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.on_call' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.incident_timeline' as FeatureKey,
        value: false,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.managed_email_fallback' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.ai_alert' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'ai.enabled'],
      },
      {
        featureKey: 'quota.alert_rules' as FeatureKey,
        value: 50,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.project_alert_rules' as FeatureKey,
        value: 25,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.alert_channels' as FeatureKey,
        value: 50,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.notification_channels' as FeatureKey,
        value: 50,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.project_notification_channels' as FeatureKey,
        value: 10,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.routing_rules' as FeatureKey,
        value: 10,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.project_routing_rules' as FeatureKey,
        value: 5,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.daily_alerts' as FeatureKey,
        value: 1000,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.monthly_alerts' as FeatureKey,
        value: 10000,
        overageRate: 10,
        overageUnit: 100,
        gracePercent: 5,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.connector_sends' as FeatureKey,
        value: 10000,
        overageRate: 25,
        overageUnit: 100,
        gracePercent: 5,
      },
      {
        featureKey: 'automation.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.automation_rules' as FeatureKey,
        value: 25,
        dependencies: ['automation.enabled'],
      },
      {
        featureKey: 'dashboards.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'dashboards.custom_dashboards' as FeatureKey,
        value: true,
        dependencies: ['dashboards.enabled'],
      },
      {
        featureKey: 'dashboards.custom_widgets' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.embeds' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.public_links' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.scheduled_reports' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.dashboards' as FeatureKey,
        value: 10,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.monthly_reports' as FeatureKey,
        value: 25,
        dependencies: ['dashboards.scheduled_reports'],
      },
      {
        featureKey: 'analytics.explorer' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'analytics.query_builder' as FeatureKey,
        value: true,
        dependencies: ['analytics.explorer'],
      },
      {
        featureKey: 'ai.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'ai.summaries' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'ai.root_cause_analysis' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
      },
      {
        featureKey: 'ai.anomaly_detection' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.forecasting' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.incident_copilot' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'alerting.enabled'],
      },
      {
        featureKey: 'quota.ai_credits' as FeatureKey,
        value: 1000,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'integrations.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.rest_api' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.connectors' as FeatureKey,
        value: 50,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'quota.integrations' as FeatureKey,
        value: 50,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'integrations.email' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.webhook' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.slack' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.discord' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.microsoft_teams' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.pagerduty' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.sms' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.github' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.gitlab' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.bitbucket' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.jira' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.terraform' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.enabled' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'security.audit_logs' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.sso' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.scim' as FeatureKey,
        value: false,
        dependencies: ['security.enabled', 'security.sso'],
      },
      {
        featureKey: 'security.custom_roles' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.service_accounts' as FeatureKey,
        value: 10,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.custom_roles' as FeatureKey,
        value: 25,
        dependencies: ['security.custom_roles'],
      },
      {
        featureKey: 'support.dedicated' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'support.sla' as FeatureKey,
        value: null,
      },
      {
        featureKey: 'deployment.custom' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.hipaa' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.gdpr_dpa' as FeatureKey,
        value: false,
      },
    ],
  },
  'business': {
    plan: {
      id: "seed-plan-business",
      key: 'business' as PlanKey,
      name: "Business",
      tier: 'business' as PlanKey,
      description: "Enterprise-ready monitoring with governance, security and automation. One organization per user.",
      trialDays: 14,
      sortOrder: 4,
      isPublic: true,
      isCustomizable: false,
      nextPlanKey: 'enterprise' as PlanKey,
      badge: "Best Value",
      metadata: {"highlightedFeatures":["security.enabled","ai.root_cause_analysis","alerting.on_call"],"recommendedFor":"Businesses requiring compliance and governance","ctaText":"Start 14-Day Free Trial"},
      prices: [
        {
          id: "seed-price-business-monthly",
          provider: "stripe",
          interval: "monthly",
          currency: "USD",
          amountMinor: 14900,
          isDefault: true,
          metadata: {"display":"$149/mo","recommended":false},
        },
        {
          id: "seed-price-business-annual",
          provider: "stripe",
          interval: "annual",
          currency: "USD",
          amountMinor: 149000,
          isDefault: false,
          metadata: {"display":"$1490/year","discount":"2 months free"},
        },
      ],
    },
    features: [
      {
        featureKey: 'organization.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'organization.max_orgs_per_user' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'projects.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.projects' as FeatureKey,
        value: 100,
      },
      {
        featureKey: 'quota.members' as FeatureKey,
        value: 250,
      },
      {
        featureKey: 'quota.environments' as FeatureKey,
        value: 25,
      },
      {
        featureKey: 'quota.api_keys' as FeatureKey,
        value: 250,
      },
      {
        featureKey: 'quota.monthly_events' as FeatureKey,
        value: 8000000,
        overageRate: 50,
        overageUnit: 1000,
        gracePercent: 10,
      },
      {
        featureKey: 'quota.requests_per_second' as FeatureKey,
        value: 5000,
      },
      {
        featureKey: 'sdk.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'sdk.remote_config' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.retry' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.batching' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.offline_queue' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.dynamic_sampling' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled', 'sdk.remote_config'],
      },
      {
        featureKey: 'quota.sdk_batch_queue_size' as FeatureKey,
        value: 50000,
        dependencies: ['sdk.batching'],
      },
      {
        featureKey: 'quota.sdk_offline_queue_limit' as FeatureKey,
        value: 25000,
        dependencies: ['sdk.offline_queue'],
      },
      {
        featureKey: 'privacy.data_scrubbing' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_headers' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_body' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_ip' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'error_tracking.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'tracing.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'logging.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'metrics.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'profiling.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'replay.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'uptime.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'cron_monitoring.enabled' as FeatureKey,
        value: true,
        dependencies: ['uptime.enabled'],
      },
      {
        featureKey: 'quota.retention_days' as FeatureKey,
        value: 180,
      },
      {
        featureKey: 'quota.log_retention_days' as FeatureKey,
        value: 180,
      },
      {
        featureKey: 'quota.metric_retention_days' as FeatureKey,
        value: 180,
      },
      {
        featureKey: 'quota.profile_retention_days' as FeatureKey,
        value: 180,
        dependencies: ['profiling.enabled'],
      },
      {
        featureKey: 'quota.replay_retention_days' as FeatureKey,
        value: 90,
        dependencies: ['replay.enabled'],
      },
      {
        featureKey: 'quota.trace_retention_days' as FeatureKey,
        value: 180,
        dependencies: ['tracing.enabled'],
      },
      {
        featureKey: 'quota.audit_log_retention_days' as FeatureKey,
        value: 365,
        dependencies: ['security.audit_logs'],
      },
      {
        featureKey: 'alerting.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'alerting.rules' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.routing.enabled' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.composite' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'alerting.rules'],
      },
      {
        featureKey: 'alerting.escalation_policies' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.on_call' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.incident_timeline' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.managed_email_fallback' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.ai_alert' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'ai.enabled'],
      },
      {
        featureKey: 'quota.alert_rules' as FeatureKey,
        value: 250,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.project_alert_rules' as FeatureKey,
        value: 100,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.alert_channels' as FeatureKey,
        value: 250,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.notification_channels' as FeatureKey,
        value: 250,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.project_notification_channels' as FeatureKey,
        value: 50,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.routing_rules' as FeatureKey,
        value: 50,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.project_routing_rules' as FeatureKey,
        value: 25,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.daily_alerts' as FeatureKey,
        value: 10000,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.monthly_alerts' as FeatureKey,
        value: 100000,
        overageRate: 10,
        overageUnit: 100,
        gracePercent: 5,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.connector_sends' as FeatureKey,
        value: 100000,
        overageRate: 25,
        overageUnit: 100,
        gracePercent: 5,
      },
      {
        featureKey: 'automation.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.automation_rules' as FeatureKey,
        value: 100,
        dependencies: ['automation.enabled'],
      },
      {
        featureKey: 'dashboards.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'dashboards.custom_dashboards' as FeatureKey,
        value: true,
        dependencies: ['dashboards.enabled'],
      },
      {
        featureKey: 'dashboards.custom_widgets' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.embeds' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.public_links' as FeatureKey,
        value: false,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.scheduled_reports' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.dashboards' as FeatureKey,
        value: 25,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.monthly_reports' as FeatureKey,
        value: 100,
        dependencies: ['dashboards.scheduled_reports'],
      },
      {
        featureKey: 'analytics.explorer' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'analytics.query_builder' as FeatureKey,
        value: true,
        dependencies: ['analytics.explorer'],
      },
      {
        featureKey: 'ai.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'ai.summaries' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'ai.root_cause_analysis' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
      },
      {
        featureKey: 'ai.anomaly_detection' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.forecasting' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.incident_copilot' as FeatureKey,
        value: false,
        dependencies: ['ai.enabled', 'alerting.enabled'],
      },
      {
        featureKey: 'quota.ai_credits' as FeatureKey,
        value: 5000,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'integrations.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.rest_api' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.connectors' as FeatureKey,
        value: 250,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'quota.integrations' as FeatureKey,
        value: 250,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'integrations.email' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.webhook' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.slack' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.discord' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.microsoft_teams' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.pagerduty' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.sms' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.github' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.gitlab' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.bitbucket' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'integrations.jira' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.terraform' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'security.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'security.audit_logs' as FeatureKey,
        value: true,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.sso' as FeatureKey,
        value: true,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.scim' as FeatureKey,
        value: false,
        dependencies: ['security.enabled', 'security.sso'],
      },
      {
        featureKey: 'security.custom_roles' as FeatureKey,
        value: false,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.service_accounts' as FeatureKey,
        value: 100,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.custom_roles' as FeatureKey,
        value: 100,
        dependencies: ['security.custom_roles'],
      },
      {
        featureKey: 'support.dedicated' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'support.sla' as FeatureKey,
        value: "99.9%",
      },
      {
        featureKey: 'deployment.custom' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.hipaa' as FeatureKey,
        value: false,
      },
      {
        featureKey: 'compliance.gdpr_dpa' as FeatureKey,
        value: true,
      },
    ],
  },
  'enterprise': {
    plan: {
      id: "seed-plan-enterprise",
      key: 'enterprise' as PlanKey,
      name: "Enterprise",
      tier: 'enterprise' as PlanKey,
      description: "Custom enterprise deployment with unlimited scale and dedicated support. One organization per user.",
      trialDays: 30,
      sortOrder: 5,
      isPublic: false,
      isCustomizable: true,
      nextPlanKey: null,
      badge: null,
      metadata: {"highlightedFeatures":["deployment.custom","compliance.hipaa","ai.incident_copilot"],"recommendedFor":"Large enterprises with custom requirements","ctaText":"Contact Sales"},
      prices: [
        {
          id: "seed-price-enterprise-monthly",
          provider: "system",
          interval: "monthly",
          currency: "USD",
          amountMinor: 0,
          isDefault: true,
          metadata: {"display":"Contact Sales","contactSales":true},
        },
        {
          id: "seed-price-enterprise-annual",
          provider: "system",
          interval: "annual",
          currency: "USD",
          amountMinor: 0,
          isDefault: false,
          metadata: {"display":"Contact Sales","contactSales":true},
        },
      ],
    },
    features: [
      {
        featureKey: 'organization.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'organization.max_orgs_per_user' as FeatureKey,
        value: 1,
      },
      {
        featureKey: 'projects.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.projects' as FeatureKey,
        value: 1000,
      },
      {
        featureKey: 'quota.members' as FeatureKey,
        value: 10000,
      },
      {
        featureKey: 'quota.environments' as FeatureKey,
        value: 100,
      },
      {
        featureKey: 'quota.api_keys' as FeatureKey,
        value: 1000,
      },
      {
        featureKey: 'quota.monthly_events' as FeatureKey,
        value: 'Custom',
        overageRate: 50,
        overageUnit: 1000,
        gracePercent: 10,
      },
      {
        featureKey: 'quota.requests_per_second' as FeatureKey,
        value: 50000,
      },
      {
        featureKey: 'sdk.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'sdk.remote_config' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.retry' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.batching' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.offline_queue' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled'],
      },
      {
        featureKey: 'sdk.dynamic_sampling' as FeatureKey,
        value: true,
        dependencies: ['sdk.enabled', 'sdk.remote_config'],
      },
      {
        featureKey: 'quota.sdk_batch_queue_size' as FeatureKey,
        value: 100000,
        dependencies: ['sdk.batching'],
      },
      {
        featureKey: 'quota.sdk_offline_queue_limit' as FeatureKey,
        value: 100000,
        dependencies: ['sdk.offline_queue'],
      },
      {
        featureKey: 'privacy.data_scrubbing' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_headers' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_body' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'privacy.capture_ip' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'error_tracking.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'tracing.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'logging.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'metrics.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'profiling.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'replay.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'uptime.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'cron_monitoring.enabled' as FeatureKey,
        value: true,
        dependencies: ['uptime.enabled'],
      },
      {
        featureKey: 'quota.retention_days' as FeatureKey,
        value: 365,
      },
      {
        featureKey: 'quota.log_retention_days' as FeatureKey,
        value: 365,
      },
      {
        featureKey: 'quota.metric_retention_days' as FeatureKey,
        value: 365,
      },
      {
        featureKey: 'quota.profile_retention_days' as FeatureKey,
        value: 365,
        dependencies: ['profiling.enabled'],
      },
      {
        featureKey: 'quota.replay_retention_days' as FeatureKey,
        value: 365,
        dependencies: ['replay.enabled'],
      },
      {
        featureKey: 'quota.trace_retention_days' as FeatureKey,
        value: 365,
        dependencies: ['tracing.enabled'],
      },
      {
        featureKey: 'quota.audit_log_retention_days' as FeatureKey,
        value: 2555,
        dependencies: ['security.audit_logs'],
      },
      {
        featureKey: 'alerting.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'alerting.rules' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.routing.enabled' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.composite' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'alerting.rules'],
      },
      {
        featureKey: 'alerting.escalation_policies' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.on_call' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.incident_timeline' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.managed_email_fallback' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'alerting.ai_alert' as FeatureKey,
        value: true,
        dependencies: ['alerting.enabled', 'ai.enabled'],
      },
      {
        featureKey: 'quota.alert_rules' as FeatureKey,
        value: 1000,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.project_alert_rules' as FeatureKey,
        value: 500,
        dependencies: ['alerting.rules'],
      },
      {
        featureKey: 'quota.alert_channels' as FeatureKey,
        value: 1000,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.notification_channels' as FeatureKey,
        value: 1000,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.project_notification_channels' as FeatureKey,
        value: 250,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.routing_rules' as FeatureKey,
        value: 200,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.project_routing_rules' as FeatureKey,
        value: 100,
        dependencies: ['alerting.routing.enabled'],
      },
      {
        featureKey: 'quota.daily_alerts' as FeatureKey,
        value: 100000,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.monthly_alerts' as FeatureKey,
        value: 1000000,
        overageRate: 10,
        overageUnit: 100,
        gracePercent: 5,
        dependencies: ['alerting.enabled'],
      },
      {
        featureKey: 'quota.connector_sends' as FeatureKey,
        value: 1000000,
        overageRate: 25,
        overageUnit: 100,
        gracePercent: 5,
      },
      {
        featureKey: 'automation.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.automation_rules' as FeatureKey,
        value: 1000,
        dependencies: ['automation.enabled'],
      },
      {
        featureKey: 'dashboards.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'dashboards.custom_dashboards' as FeatureKey,
        value: true,
        dependencies: ['dashboards.enabled'],
      },
      {
        featureKey: 'dashboards.custom_widgets' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.embeds' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.public_links' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'dashboards.scheduled_reports' as FeatureKey,
        value: true,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.dashboards' as FeatureKey,
        value: 1000,
        dependencies: ['dashboards.custom_dashboards'],
      },
      {
        featureKey: 'quota.monthly_reports' as FeatureKey,
        value: 1000,
        dependencies: ['dashboards.scheduled_reports'],
      },
      {
        featureKey: 'analytics.explorer' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'analytics.query_builder' as FeatureKey,
        value: true,
        dependencies: ['analytics.explorer'],
      },
      {
        featureKey: 'ai.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'ai.summaries' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'ai.root_cause_analysis' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'error_tracking.enabled', 'tracing.enabled'],
      },
      {
        featureKey: 'ai.anomaly_detection' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.forecasting' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'metrics.enabled'],
      },
      {
        featureKey: 'ai.incident_copilot' as FeatureKey,
        value: true,
        dependencies: ['ai.enabled', 'alerting.enabled'],
      },
      {
        featureKey: 'quota.ai_credits' as FeatureKey,
        value: 50000,
        dependencies: ['ai.enabled'],
      },
      {
        featureKey: 'integrations.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.rest_api' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'quota.connectors' as FeatureKey,
        value: 1000,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'quota.integrations' as FeatureKey,
        value: 1000,
        dependencies: ['integrations.enabled'],
      },
      {
        featureKey: 'integrations.email' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.webhook' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.slack' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.discord' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.microsoft_teams' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.pagerduty' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.sms' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.github' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.gitlab' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.bitbucket' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.jira' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'integrations.terraform' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'security.enabled' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'security.audit_logs' as FeatureKey,
        value: true,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.sso' as FeatureKey,
        value: true,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'security.scim' as FeatureKey,
        value: true,
        dependencies: ['security.enabled', 'security.sso'],
      },
      {
        featureKey: 'security.custom_roles' as FeatureKey,
        value: true,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.service_accounts' as FeatureKey,
        value: 1000,
        dependencies: ['security.enabled'],
      },
      {
        featureKey: 'quota.custom_roles' as FeatureKey,
        value: 1000,
        dependencies: ['security.custom_roles'],
      },
      {
        featureKey: 'support.dedicated' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'support.sla' as FeatureKey,
        value: "99.99%",
      },
      {
        featureKey: 'deployment.custom' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'compliance.hipaa' as FeatureKey,
        value: true,
      },
      {
        featureKey: 'compliance.gdpr_dpa' as FeatureKey,
        value: true,
      },
    ],
  },
} as const;

export const CANONICAL_PLAN_MATRIX = PLAN_MATRIX;

/**
 * Returns all feature values configured for a plan.
 */
export function getPlanFeatures(planKey: PlanKey): PlanFeatureValue[] {
  const entry = PLAN_MATRIX[planKey];
  if (!entry) {
    throw new PlanNotFoundError(planKey);
  }
  return [...entry.features];
}

/**
 * Returns the configured entitlement value for a specific plan and feature.
 */
export function getFeatureValue(planKey: PlanKey, featureKey: FeatureKey): PlanFeatureValue | undefined {
  const features = getPlanFeatures(planKey);
  return features.find(f => f.featureKey === featureKey);
}

/**
 * Checks if a boolean feature is enabled (true) on a plan.
 */
export function isFeatureEnabled(planKey: PlanKey, featureKey: FeatureKey): boolean {
  const feat = getFeatureValue(planKey, featureKey);
  return feat?.value === true;
}

/**
 * Returns the integer numeric quota value for a feature on a plan, if defined.
 * If value is -1 (unlimited) or an integer, it returns that number.
 */
export function getQuotaValue(planKey: PlanKey, featureKey: FeatureKey): number | undefined {
  const feat = getFeatureValue(planKey, featureKey);
  if (typeof feat?.value === 'number') {
    return feat.value;
  }
  return undefined;
}

/**
 * Compares two plans and returns array of feature keys whose values/limits differ.
 */
export function comparePlans(from: PlanKey, to: PlanKey): FeatureKey[] {
  const fromFeatures = getPlanFeatures(from);
  const toFeaturesMap = new Map(getPlanFeatures(to).map(f => [f.featureKey, f]));
  const differences: FeatureKey[] = [];

  for (const fromFeat of fromFeatures) {
    const toFeat = toFeaturesMap.get(fromFeat.featureKey);
    if (!toFeat) {
      differences.push(fromFeat.featureKey);
      continue;
    }
    if (
      fromFeat.value !== toFeat.value ||
      fromFeat.overageRate !== toFeat.overageRate ||
      fromFeat.overageUnit !== toFeat.overageUnit ||
      fromFeat.gracePercent !== toFeat.gracePercent
    ) {
      differences.push(fromFeat.featureKey);
    }
  }

  return differences;
}
