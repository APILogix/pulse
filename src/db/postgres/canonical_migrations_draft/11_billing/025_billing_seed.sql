-- =============================================================================
-- Module      : Billing
-- Migration   : 025_billing_seed.sql
-- Description : Idempotent seed of plans, features, entitlements, addons, prices
-- Author      : AI Agent (Pulsiv Billing Seeder)
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. PLANS
-- =============================================================================

INSERT INTO plans
    (key, version, name, tier, description, trial_days, is_active, is_public, sort_order)
VALUES
    ('free', 1, 'Free', 'free', 'For solo developers and small side projects. 5,000 events/month.', 0, TRUE, TRUE, 1),
    ('starter', 1, 'Starter', 'starter', 'For small teams getting serious about observability. 100K events/month.', 14, TRUE, TRUE, 2),
    ('growth', 1, 'Growth', 'growth', 'For growing teams that need scale and intelligence. 1M events/month.', 14, TRUE, TRUE, 3),
    ('business', 1, 'Business', 'business', 'For engineering teams demanding performance and control. 5M events/month.', 14, TRUE, TRUE, 4),
    ('enterprise', 1, 'Enterprise', 'enterprise', 'For organizations requiring maximum scale, security, and customization. Custom pricing.', 30, TRUE, FALSE, 5)
ON CONFLICT (key, version) DO UPDATE
SET name = EXCLUDED.name,
    tier = EXCLUDED.tier,
    description = EXCLUDED.description,
    trial_days = EXCLUDED.trial_days,
    is_active = EXCLUDED.is_active,
    is_public = EXCLUDED.is_public,
    sort_order = EXCLUDED.sort_order,
    deleted_at = NULL,
    updated_at = NOW();

-- =============================================================================
-- 2. PLAN PRICES
-- =============================================================================

WITH price_seed(plan_key, provider, billing_interval, currency, amount_minor, is_default) AS (
VALUES
    ('starter', 'stripe', 'monthly', 'USD', 2900::bigint, TRUE),
    ('starter', 'stripe', 'annual', 'USD', 29000::bigint, FALSE),
    ('growth', 'stripe', 'monthly', 'USD', 9900::bigint, TRUE),
    ('growth', 'stripe', 'annual', 'USD', 99000::bigint, FALSE),
    ('business', 'stripe', 'monthly', 'USD', 29900::bigint, TRUE),
    ('business', 'stripe', 'annual', 'USD', 299000::bigint, FALSE)
)
INSERT INTO plan_prices
    (plan_id, provider, billing_interval, currency, amount_minor, provider_price_id, is_default, starts_at, ends_at, metadata)
SELECT
    p.id,
    ps.provider::billing_provider_type,
    ps.billing_interval::billing_interval_type,
    ps.currency,
    ps.amount_minor,
    NULL::text,
    ps.is_default,
    '-infinity'::timestamptz,
    NULL::timestamptz,
    '{}'::jsonb
FROM price_seed ps
JOIN plans p
  ON p.key = ps.plan_key
 AND p.version = 1
 AND p.deleted_at IS NULL
ON CONFLICT (plan_id, provider, billing_interval, currency, starts_at) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    provider_price_id = EXCLUDED.provider_price_id,
    is_default = EXCLUDED.is_default,
    ends_at = EXCLUDED.ends_at,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- =============================================================================
-- 3. BILLING FEATURES
-- =============================================================================

WITH feature_seed(feature_key, category, value_type, module, is_module_root, sort_order) AS (
VALUES
    ('monthly_events', 'limits', 'integer', NULL, FALSE, 1),
    ('limit_projects_max', 'limits', 'integer', NULL, FALSE, 2),
    ('limit_members_max', 'limits', 'integer', NULL, FALSE, 3),
    ('limit_api_keys_max', 'limits', 'integer', NULL, FALSE, 4),
    ('limit_connectors_max', 'limits', 'integer', NULL, FALSE, 5),
    ('limit_alert_rules_max', 'limits', 'integer', NULL, FALSE, 6),
    ('limit_workflows_max', 'limits', 'integer', NULL, FALSE, 7),
    ('limit_dashboards_max', 'limits', 'integer', NULL, FALSE, 8),
    ('limit_environments_max', 'limits', 'integer', NULL, FALSE, 9),
    ('module_error_tracking_enabled', 'monitoring', 'boolean', 'error_tracking', TRUE, 100),
    ('module_error_tracking_retention_days', 'monitoring', 'integer', 'error_tracking', FALSE, 101),
    ('module_error_tracking_features_issue_grouping', 'monitoring', 'boolean', 'error_tracking', FALSE, 102),
    ('module_error_tracking_features_release_tracking', 'monitoring', 'boolean', 'error_tracking', FALSE, 103),
    ('module_error_tracking_features_source_maps', 'monitoring', 'boolean', 'error_tracking', FALSE, 104),
    ('module_error_tracking_features_breadcrumbs', 'monitoring', 'boolean', 'error_tracking', FALSE, 105),
    ('module_error_tracking_features_user_feedback', 'monitoring', 'boolean', 'error_tracking', FALSE, 106),
    ('module_distributed_tracing_enabled', 'monitoring', 'boolean', 'distributed_tracing', TRUE, 110),
    ('module_distributed_tracing_retention_days', 'monitoring', 'integer', 'distributed_tracing', FALSE, 111),
    ('module_distributed_tracing_features_trace_view', 'monitoring', 'boolean', 'distributed_tracing', FALSE, 112),
    ('module_distributed_tracing_features_span_details', 'monitoring', 'boolean', 'distributed_tracing', FALSE, 113),
    ('module_distributed_tracing_features_performance_insights', 'monitoring', 'boolean', 'distributed_tracing', FALSE, 114),
    ('module_distributed_tracing_features_distributed_correlation', 'monitoring', 'boolean', 'distributed_tracing', FALSE, 115),
    ('module_logging_enabled', 'monitoring', 'boolean', 'logging', TRUE, 120),
    ('module_logging_retention_days', 'monitoring', 'integer', 'logging', FALSE, 121),
    ('module_logging_features_log_search', 'monitoring', 'boolean', 'logging', FALSE, 122),
    ('module_logging_features_log_patterns', 'monitoring', 'boolean', 'logging', FALSE, 123),
    ('module_logging_features_structured_parsing', 'monitoring', 'boolean', 'logging', FALSE, 124),
    ('module_logging_features_live_tail', 'monitoring', 'boolean', 'logging', FALSE, 125),
    ('module_metrics_enabled', 'monitoring', 'boolean', 'metrics', TRUE, 130),
    ('module_metrics_retention_days', 'monitoring', 'integer', 'metrics', FALSE, 131),
    ('module_metrics_features_custom_dashboards', 'monitoring', 'boolean', 'metrics', FALSE, 132),
    ('module_metrics_features_metric_alerts', 'monitoring', 'boolean', 'metrics', FALSE, 133),
    ('module_metrics_features_derived_metrics', 'monitoring', 'boolean', 'metrics', FALSE, 134),
    ('module_metrics_features_metric_export', 'monitoring', 'boolean', 'metrics', FALSE, 135),
    ('module_profiling_enabled', 'monitoring', 'boolean', 'profiling', TRUE, 140),
    ('module_profiling_retention_days', 'monitoring', 'integer', 'profiling', FALSE, 141),
    ('module_profiling_features_flame_graphs', 'monitoring', 'boolean', 'profiling', FALSE, 142),
    ('module_profiling_features_differential_profiling', 'monitoring', 'boolean', 'profiling', FALSE, 143),
    ('module_profiling_features_code_hotspots', 'monitoring', 'boolean', 'profiling', FALSE, 144),
    ('module_session_replay_enabled', 'monitoring', 'boolean', 'session_replay', TRUE, 150),
    ('module_session_replay_retention_days', 'monitoring', 'integer', 'session_replay', FALSE, 151),
    ('module_session_replay_features_rrweb_playback', 'monitoring', 'boolean', 'session_replay', FALSE, 152),
    ('module_session_replay_features_rage_clicks', 'monitoring', 'boolean', 'session_replay', FALSE, 153),
    ('module_session_replay_features_dead_clicks', 'monitoring', 'boolean', 'session_replay', FALSE, 154),
    ('module_session_replay_features_privacy_masking', 'monitoring', 'boolean', 'session_replay', FALSE, 155),
    ('module_cron_monitoring_enabled', 'monitoring', 'boolean', 'cron_monitoring', TRUE, 160),
    ('module_cron_monitoring_features_job_scheduling', 'monitoring', 'boolean', 'cron_monitoring', FALSE, 161),
    ('module_cron_monitoring_features_missed_job_detection', 'monitoring', 'boolean', 'cron_monitoring', FALSE, 162),
    ('module_cron_monitoring_features_job_duration_tracking', 'monitoring', 'boolean', 'cron_monitoring', FALSE, 163),
    ('module_uptime_monitoring_enabled', 'monitoring', 'boolean', 'uptime_monitoring', TRUE, 170),
    ('module_uptime_monitoring_features_synthetic_checks', 'monitoring', 'boolean', 'uptime_monitoring', FALSE, 171),
    ('module_uptime_monitoring_features_multi_region', 'monitoring', 'boolean', 'uptime_monitoring', FALSE, 172),
    ('module_uptime_monitoring_features_ssl_monitoring', 'monitoring', 'boolean', 'uptime_monitoring', FALSE, 173),
    ('module_uptime_monitoring_features_status_page', 'monitoring', 'boolean', 'uptime_monitoring', FALSE, 174),
    ('module_ai_insights_enabled', 'ai', 'boolean', 'ai_insights', TRUE, 200),
    ('module_ai_insights_monthly_credits', 'ai', 'integer', 'ai_insights', FALSE, 201),
    ('module_ai_insights_features_error_explanation', 'ai', 'boolean', 'ai_insights', FALSE, 202),
    ('module_ai_insights_features_root_cause_analysis', 'ai', 'boolean', 'ai_insights', FALSE, 203),
    ('module_ai_insights_features_stack_trace_analysis', 'ai', 'boolean', 'ai_insights', FALSE, 204),
    ('module_ai_insights_features_trace_analysis', 'ai', 'boolean', 'ai_insights', FALSE, 205),
    ('module_ai_insights_features_span_analysis', 'ai', 'boolean', 'ai_insights', FALSE, 206),
    ('module_ai_insights_features_suggested_fixes', 'ai', 'boolean', 'ai_insights', FALSE, 207),
    ('module_ai_insights_features_sql_optimization', 'ai', 'boolean', 'ai_insights', FALSE, 208),
    ('module_ai_insights_features_log_summary', 'ai', 'boolean', 'ai_insights', FALSE, 209),
    ('module_ai_insights_features_deployment_correlation', 'ai', 'boolean', 'ai_insights', FALSE, 210),
    ('module_ai_insights_features_incident_summary', 'ai', 'boolean', 'ai_insights', FALSE, 211),
    ('module_ai_insights_features_weekly_report', 'ai', 'boolean', 'ai_insights', FALSE, 212),
    ('module_ai_insights_features_chat_assistant', 'ai', 'boolean', 'ai_insights', FALSE, 213),
    ('module_alerting_enabled', 'alerts', 'boolean', 'alerting', TRUE, 300),
    ('module_alerting_features_basic_email', 'alerts', 'boolean', 'alerting', FALSE, 301),
    ('module_alerting_features_multi_channel', 'alerts', 'boolean', 'alerting', FALSE, 302),
    ('module_alerting_features_escalation_policies', 'alerts', 'boolean', 'alerting', FALSE, 303),
    ('module_alerting_features_deduplication', 'alerts', 'boolean', 'alerting', FALSE, 304),
    ('module_alerting_features_silencing', 'alerts', 'boolean', 'alerting', FALSE, 305),
    ('module_alerting_features_throttling', 'alerts', 'boolean', 'alerting', FALSE, 306),
    ('module_alerting_features_custom_alert_rules', 'alerts', 'boolean', 'alerting', FALSE, 307),
    ('module_connectors_enabled', 'integrations', 'boolean', 'connectors', TRUE, 400),
    ('module_connectors_features_sync_audit_logs', 'integrations', 'boolean', 'connectors', FALSE, 401),
    ('module_connectors_features_multi_channel_per_alert', 'integrations', 'boolean', 'connectors', FALSE, 402),
    ('module_connectors_features_connector_slack', 'integrations', 'boolean', 'connectors', FALSE, 403),
    ('module_connectors_features_connector_discord', 'integrations', 'boolean', 'connectors', FALSE, 404),
    ('module_connectors_features_connector_pagerduty', 'integrations', 'boolean', 'connectors', FALSE, 405),
    ('module_connectors_features_connector_teams', 'integrations', 'boolean', 'connectors', FALSE, 406),
    ('module_connectors_features_connector_webhook', 'integrations', 'boolean', 'connectors', FALSE, 407),
    ('module_connectors_features_connector_email', 'integrations', 'boolean', 'connectors', FALSE, 408),
    ('module_analytics_enabled', 'dashboard', 'boolean', 'analytics', TRUE, 500),
    ('module_analytics_level', 'dashboard', 'string', 'analytics', FALSE, 501),
    ('module_analytics_features_real_time', 'dashboard', 'boolean', 'analytics', FALSE, 502),
    ('module_analytics_features_custom_dashboards', 'dashboard', 'boolean', 'analytics', FALSE, 503),
    ('module_analytics_features_data_export', 'dashboard', 'boolean', 'analytics', FALSE, 504),
    ('module_analytics_features_advanced_filtering', 'dashboard', 'boolean', 'analytics', FALSE, 505),
    ('module_analytics_features_comparative_analysis', 'dashboard', 'boolean', 'analytics', FALSE, 506),
    ('module_analytics_features_trend_forecasting', 'dashboard', 'boolean', 'analytics', FALSE, 507),
    ('module_analytics_features_custom_reports', 'dashboard', 'boolean', 'analytics', FALSE, 508),
    ('module_sdk_enabled', 'monitoring', 'boolean', 'sdk', TRUE, 600),
    ('module_sdk_auto_instrumentation', 'monitoring', 'string', 'sdk', FALSE, 601),
    ('module_sdk_offline_queue', 'monitoring', 'boolean', 'sdk', FALSE, 602),
    ('module_sdk_remote_control', 'monitoring', 'boolean', 'sdk', FALSE, 603),
    ('module_sdk_sampling_error_rate', 'monitoring', 'decimal', 'sdk', FALSE, 604),
    ('module_sdk_sampling_trace_rate', 'monitoring', 'decimal', 'sdk', FALSE, 605),
    ('module_sdk_sampling_remotely_configurable', 'monitoring', 'boolean', 'sdk', FALSE, 606),
    ('module_enterprise_enabled', 'security', 'boolean', 'enterprise', TRUE, 700),
    ('module_enterprise_features_sso', 'security', 'boolean', 'enterprise', FALSE, 701),
    ('module_enterprise_features_scim', 'security', 'boolean', 'enterprise', FALSE, 702),
    ('module_enterprise_features_audit_logs', 'security', 'boolean', 'enterprise', FALSE, 703),
    ('module_enterprise_features_custom_retention', 'security', 'boolean', 'enterprise', FALSE, 704),
    ('module_enterprise_features_custom_domains', 'security', 'boolean', 'enterprise', FALSE, 705),
    ('module_enterprise_features_private_networking', 'security', 'boolean', 'enterprise', FALSE, 706),
    ('module_enterprise_features_priority_queue', 'security', 'boolean', 'enterprise', FALSE, 707),
    ('module_enterprise_features_dedicated_workers', 'security', 'boolean', 'enterprise', FALSE, 708),
    ('module_enterprise_sla', 'security', 'string', 'enterprise', FALSE, 709),
    ('module_enterprise_data_residency', 'security', 'string', 'enterprise', FALSE, 710),
    ('module_support_level', 'organization', 'string', 'support', TRUE, 800),
    ('module_support_response_time', 'organization', 'string', 'support', FALSE, 801),
    ('module_support_dedicated_manager', 'organization', 'boolean', 'support', FALSE, 802),
    ('module_support_onboarding', 'organization', 'boolean', 'support', FALSE, 803)
)
INSERT INTO billing_features
    (feature_key, feature_name, description, category, value_type, module, is_module_root, sort_order, is_billable, is_public, metadata)
SELECT
    fs.feature_key,
    initcap(replace(fs.feature_key, '_', ' ')),
    NULL::text,
    fs.category::billing_feature_category,
    fs.value_type::billing_feature_value_type,
    fs.module,
    fs.is_module_root,
    fs.sort_order,
    TRUE,
    TRUE,
    '{}'::jsonb
FROM feature_seed fs
ON CONFLICT (feature_key) DO UPDATE
SET feature_name = EXCLUDED.feature_name,
    category = EXCLUDED.category,
    value_type = EXCLUDED.value_type,
    module = EXCLUDED.module,
    is_module_root = EXCLUDED.is_module_root,
    sort_order = EXCLUDED.sort_order,
    is_billable = EXCLUDED.is_billable,
    is_public = EXCLUDED.is_public,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- =============================================================================
-- 4. PLAN FEATURE ENTITLEMENTS
-- =============================================================================

WITH plan_scope AS (
    SELECT id, key
    FROM plans
    WHERE key IN ('free', 'starter', 'growth', 'business', 'enterprise')
      AND version = 1
      AND deleted_at IS NULL
),
feature_scope AS (
    SELECT id, feature_key, value_type
    FROM billing_features
    WHERE feature_key IN (
        'monthly_events','limit_projects_max','limit_members_max','limit_api_keys_max','limit_connectors_max','limit_alert_rules_max','limit_workflows_max','limit_dashboards_max','limit_environments_max',
        'module_error_tracking_enabled','module_error_tracking_retention_days','module_error_tracking_features_issue_grouping','module_error_tracking_features_release_tracking','module_error_tracking_features_source_maps','module_error_tracking_features_breadcrumbs','module_error_tracking_features_user_feedback',
        'module_distributed_tracing_enabled','module_distributed_tracing_retention_days','module_distributed_tracing_features_trace_view','module_distributed_tracing_features_span_details','module_distributed_tracing_features_performance_insights','module_distributed_tracing_features_distributed_correlation',
        'module_logging_enabled','module_logging_retention_days','module_logging_features_log_search','module_logging_features_log_patterns','module_logging_features_structured_parsing','module_logging_features_live_tail',
        'module_metrics_enabled','module_metrics_retention_days','module_metrics_features_custom_dashboards','module_metrics_features_metric_alerts','module_metrics_features_derived_metrics','module_metrics_features_metric_export',
        'module_profiling_enabled','module_profiling_retention_days','module_profiling_features_flame_graphs','module_profiling_features_differential_profiling','module_profiling_features_code_hotspots',
        'module_session_replay_enabled','module_session_replay_retention_days','module_session_replay_features_rrweb_playback','module_session_replay_features_rage_clicks','module_session_replay_features_dead_clicks','module_session_replay_features_privacy_masking',
        'module_cron_monitoring_enabled','module_cron_monitoring_features_job_scheduling','module_cron_monitoring_features_missed_job_detection','module_cron_monitoring_features_job_duration_tracking',
        'module_uptime_monitoring_enabled','module_uptime_monitoring_features_synthetic_checks','module_uptime_monitoring_features_multi_region','module_uptime_monitoring_features_ssl_monitoring','module_uptime_monitoring_features_status_page',
        'module_ai_insights_enabled','module_ai_insights_monthly_credits','module_ai_insights_features_error_explanation','module_ai_insights_features_root_cause_analysis','module_ai_insights_features_stack_trace_analysis','module_ai_insights_features_trace_analysis','module_ai_insights_features_span_analysis','module_ai_insights_features_suggested_fixes','module_ai_insights_features_sql_optimization','module_ai_insights_features_log_summary','module_ai_insights_features_deployment_correlation','module_ai_insights_features_incident_summary','module_ai_insights_features_weekly_report','module_ai_insights_features_chat_assistant',
        'module_alerting_enabled','module_alerting_features_basic_email','module_alerting_features_multi_channel','module_alerting_features_escalation_policies','module_alerting_features_deduplication','module_alerting_features_silencing','module_alerting_features_throttling','module_alerting_features_custom_alert_rules',
        'module_connectors_enabled','module_connectors_features_sync_audit_logs','module_connectors_features_multi_channel_per_alert','module_connectors_features_connector_slack','module_connectors_features_connector_discord','module_connectors_features_connector_pagerduty','module_connectors_features_connector_teams','module_connectors_features_connector_webhook','module_connectors_features_connector_email',
        'module_analytics_enabled','module_analytics_level','module_analytics_features_real_time','module_analytics_features_custom_dashboards','module_analytics_features_data_export','module_analytics_features_advanced_filtering','module_analytics_features_comparative_analysis','module_analytics_features_trend_forecasting','module_analytics_features_custom_reports',
        'module_sdk_enabled','module_sdk_auto_instrumentation','module_sdk_offline_queue','module_sdk_remote_control','module_sdk_sampling_error_rate','module_sdk_sampling_trace_rate','module_sdk_sampling_remotely_configurable',
        'module_enterprise_enabled','module_enterprise_features_sso','module_enterprise_features_scim','module_enterprise_features_audit_logs','module_enterprise_features_custom_retention','module_enterprise_features_custom_domains','module_enterprise_features_private_networking','module_enterprise_features_priority_queue','module_enterprise_features_dedicated_workers','module_enterprise_sla','module_enterprise_data_residency',
        'module_support_level','module_support_response_time','module_support_dedicated_manager','module_support_onboarding'
    )
      AND deleted_at IS NULL
),
entitlement_values AS (
    SELECT
        p.id AS plan_id,
        f.id AS feature_id,
        CASE WHEN f.value_type = 'boolean' THEN
            CASE
                WHEN p.key = 'enterprise' THEN TRUE
                WHEN p.key = 'business' THEN f.feature_key <> 'module_enterprise_features_private_networking' AND f.feature_key <> 'module_support_dedicated_manager'
                WHEN p.key = 'growth' THEN f.feature_key = ANY(ARRAY[
                    'module_error_tracking_enabled','module_error_tracking_features_issue_grouping','module_error_tracking_features_release_tracking','module_error_tracking_features_source_maps','module_error_tracking_features_breadcrumbs','module_error_tracking_features_user_feedback',
                    'module_distributed_tracing_enabled','module_distributed_tracing_features_trace_view','module_distributed_tracing_features_span_details','module_distributed_tracing_features_performance_insights','module_distributed_tracing_features_distributed_correlation',
                    'module_logging_enabled','module_logging_features_log_search','module_logging_features_log_patterns','module_logging_features_structured_parsing','module_logging_features_live_tail',
                    'module_metrics_enabled','module_metrics_features_custom_dashboards','module_metrics_features_metric_alerts','module_metrics_features_derived_metrics',
                    'module_profiling_enabled','module_profiling_features_flame_graphs','module_profiling_features_differential_profiling',
                    'module_session_replay_enabled','module_session_replay_features_rrweb_playback','module_session_replay_features_rage_clicks','module_session_replay_features_dead_clicks','module_session_replay_features_privacy_masking',
                    'module_cron_monitoring_enabled','module_cron_monitoring_features_job_scheduling','module_cron_monitoring_features_missed_job_detection','module_cron_monitoring_features_job_duration_tracking',
                    'module_uptime_monitoring_enabled','module_uptime_monitoring_features_synthetic_checks','module_uptime_monitoring_features_multi_region','module_uptime_monitoring_features_ssl_monitoring','module_uptime_monitoring_features_status_page',
                    'module_ai_insights_enabled','module_ai_insights_features_error_explanation','module_ai_insights_features_root_cause_analysis','module_ai_insights_features_stack_trace_analysis','module_ai_insights_features_trace_analysis','module_ai_insights_features_suggested_fixes','module_ai_insights_features_log_summary','module_ai_insights_features_deployment_correlation','module_ai_insights_features_incident_summary',
                    'module_alerting_enabled','module_alerting_features_basic_email','module_alerting_features_multi_channel','module_alerting_features_escalation_policies','module_alerting_features_deduplication','module_alerting_features_silencing','module_alerting_features_throttling','module_alerting_features_custom_alert_rules',
                    'module_connectors_enabled','module_connectors_features_sync_audit_logs','module_connectors_features_multi_channel_per_alert','module_connectors_features_connector_slack','module_connectors_features_connector_discord','module_connectors_features_connector_pagerduty','module_connectors_features_connector_teams','module_connectors_features_connector_webhook','module_connectors_features_connector_email',
                    'module_analytics_enabled','module_analytics_features_real_time','module_analytics_features_custom_dashboards','module_analytics_features_data_export','module_analytics_features_advanced_filtering','module_analytics_features_comparative_analysis',
                    'module_sdk_enabled','module_sdk_offline_queue','module_sdk_remote_control','module_sdk_sampling_remotely_configurable',
                    'module_enterprise_enabled','module_enterprise_features_audit_logs','module_enterprise_features_priority_queue',
                    'module_support_onboarding'
                ])
                WHEN p.key = 'starter' THEN f.feature_key = ANY(ARRAY[
                    'module_error_tracking_enabled','module_error_tracking_features_issue_grouping','module_error_tracking_features_release_tracking','module_error_tracking_features_source_maps','module_error_tracking_features_breadcrumbs','module_error_tracking_features_user_feedback',
                    'module_distributed_tracing_enabled','module_distributed_tracing_features_trace_view','module_distributed_tracing_features_span_details','module_distributed_tracing_features_performance_insights',
                    'module_logging_enabled','module_logging_features_log_search','module_logging_features_log_patterns','module_logging_features_structured_parsing',
                    'module_metrics_enabled','module_metrics_features_metric_alerts',
                    'module_ai_insights_enabled','module_ai_insights_features_error_explanation','module_ai_insights_features_stack_trace_analysis','module_ai_insights_features_log_summary',
                    'module_alerting_enabled','module_alerting_features_basic_email','module_alerting_features_multi_channel','module_alerting_features_deduplication','module_alerting_features_silencing','module_alerting_features_throttling','module_alerting_features_custom_alert_rules',
                    'module_connectors_enabled','module_connectors_features_sync_audit_logs','module_connectors_features_multi_channel_per_alert','module_connectors_features_connector_slack','module_connectors_features_connector_discord','module_connectors_features_connector_webhook','module_connectors_features_connector_email',
                    'module_analytics_enabled','module_analytics_features_real_time','module_analytics_features_advanced_filtering',
                    'module_sdk_enabled','module_sdk_offline_queue','module_sdk_remote_control','module_sdk_sampling_remotely_configurable',
                    'module_enterprise_enabled','module_enterprise_features_audit_logs'
                ])
                WHEN p.key = 'free' THEN f.feature_key = ANY(ARRAY[
                    'module_error_tracking_enabled','module_error_tracking_features_issue_grouping','module_error_tracking_features_breadcrumbs',
                    'module_distributed_tracing_enabled','module_distributed_tracing_features_trace_view',
                    'module_logging_enabled','module_logging_features_log_search','module_logging_features_structured_parsing',
                    'module_metrics_enabled',
                    'module_alerting_enabled','module_alerting_features_basic_email',
                    'module_connectors_enabled','module_connectors_features_connector_email',
                    'module_sdk_enabled'
                ])
                ELSE FALSE
            END
        END AS boolean_value,
        CASE WHEN f.value_type = 'integer' THEN
            CASE f.feature_key
                WHEN 'monthly_events' THEN CASE p.key WHEN 'free' THEN 5000 WHEN 'starter' THEN 100000 WHEN 'growth' THEN 1000000 WHEN 'business' THEN 5000000 ELSE -1 END
                WHEN 'limit_projects_max' THEN CASE p.key WHEN 'free' THEN 3 WHEN 'starter' THEN 10 WHEN 'growth' THEN 25 WHEN 'business' THEN 50 ELSE -1 END
                WHEN 'limit_members_max' THEN CASE p.key WHEN 'free' THEN 1 WHEN 'starter' THEN 5 WHEN 'growth' THEN 20 WHEN 'business' THEN 100 ELSE -1 END
                WHEN 'limit_api_keys_max' THEN CASE p.key WHEN 'free' THEN 2 WHEN 'starter' THEN 10 WHEN 'growth' THEN 25 WHEN 'business' THEN 100 ELSE -1 END
                WHEN 'limit_connectors_max' THEN CASE p.key WHEN 'free' THEN 1 WHEN 'starter' THEN 3 WHEN 'growth' THEN 10 WHEN 'business' THEN 50 ELSE -1 END
                WHEN 'limit_alert_rules_max' THEN CASE p.key WHEN 'free' THEN 5 WHEN 'starter' THEN 25 WHEN 'growth' THEN 100 WHEN 'business' THEN 500 ELSE -1 END
                WHEN 'limit_workflows_max' THEN CASE p.key WHEN 'free' THEN 0 WHEN 'starter' THEN 5 WHEN 'growth' THEN 25 WHEN 'business' THEN 200 ELSE -1 END
                WHEN 'limit_dashboards_max' THEN CASE p.key WHEN 'free' THEN 1 WHEN 'starter' THEN 5 WHEN 'growth' THEN 25 WHEN 'business' THEN 100 ELSE -1 END
                WHEN 'limit_environments_max' THEN CASE p.key WHEN 'free' THEN 2 WHEN 'starter' THEN 5 WHEN 'growth' THEN 10 WHEN 'business' THEN 25 ELSE -1 END
                WHEN 'module_error_tracking_retention_days' THEN CASE p.key WHEN 'free' THEN 7 WHEN 'starter' THEN 30 WHEN 'growth' THEN 60 WHEN 'business' THEN 90 ELSE -1 END
                WHEN 'module_distributed_tracing_retention_days' THEN CASE p.key WHEN 'free' THEN 3 WHEN 'starter' THEN 14 WHEN 'growth' THEN 30 WHEN 'business' THEN 30 ELSE -1 END
                WHEN 'module_logging_retention_days' THEN CASE p.key WHEN 'free' THEN 3 WHEN 'starter' THEN 14 WHEN 'growth' THEN 30 WHEN 'business' THEN 30 ELSE -1 END
                WHEN 'module_metrics_retention_days' THEN CASE p.key WHEN 'free' THEN 7 WHEN 'starter' THEN 30 WHEN 'growth' THEN 90 WHEN 'business' THEN 365 ELSE -1 END
                WHEN 'module_profiling_retention_days' THEN CASE p.key WHEN 'free' THEN 0 WHEN 'starter' THEN 0 WHEN 'growth' THEN 14 WHEN 'business' THEN 30 ELSE -1 END
                WHEN 'module_session_replay_retention_days' THEN CASE p.key WHEN 'free' THEN 0 WHEN 'starter' THEN 0 WHEN 'growth' THEN 14 WHEN 'business' THEN 30 ELSE -1 END
                WHEN 'module_ai_insights_monthly_credits' THEN CASE p.key WHEN 'free' THEN 0 WHEN 'starter' THEN 500 WHEN 'growth' THEN 2500 WHEN 'business' THEN 10000 ELSE -1 END
            END::bigint
        END AS integer_value,
        CASE WHEN f.value_type = 'decimal' THEN
            CASE f.feature_key
                WHEN 'module_sdk_sampling_error_rate' THEN 1.0
                WHEN 'module_sdk_sampling_trace_rate' THEN CASE p.key WHEN 'free' THEN 0.1 WHEN 'starter' THEN 0.2 WHEN 'growth' THEN 0.3 WHEN 'business' THEN 0.5 ELSE 1.0 END
            END::numeric(20,6)
        END AS decimal_value,
        CASE WHEN f.value_type = 'string' THEN
            CASE f.feature_key
                WHEN 'module_analytics_level' THEN CASE p.key WHEN 'free' THEN 'none' WHEN 'starter' THEN 'basic' WHEN 'growth' THEN 'advanced' WHEN 'business' THEN 'advanced' ELSE 'enterprise' END
                WHEN 'module_sdk_auto_instrumentation' THEN CASE p.key WHEN 'free' THEN 'basic' WHEN 'starter' THEN 'advanced' WHEN 'growth' THEN 'advanced' WHEN 'business' THEN 'pro' ELSE 'pro' END
                WHEN 'module_enterprise_sla' THEN CASE p.key WHEN 'free' THEN NULL::text WHEN 'starter' THEN '99.5%' WHEN 'growth' THEN '99.9%' WHEN 'business' THEN '99.95%' ELSE 'custom' END
                WHEN 'module_enterprise_data_residency' THEN CASE p.key WHEN 'free' THEN NULL::text WHEN 'starter' THEN 'US' WHEN 'growth' THEN 'US,EU' WHEN 'business' THEN 'US,EU,APAC' ELSE 'custom' END
                WHEN 'module_support_level' THEN CASE p.key WHEN 'free' THEN 'community' WHEN 'starter' THEN 'standard' WHEN 'growth' THEN 'priority' WHEN 'business' THEN 'business' ELSE 'enterprise' END
                WHEN 'module_support_response_time' THEN CASE p.key WHEN 'free' THEN NULL::text WHEN 'starter' THEN '48h' WHEN 'growth' THEN '24h' WHEN 'business' THEN '4h' ELSE '1h' END
            END
        END AS string_value
    FROM plan_scope p
    CROSS JOIN feature_scope f
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value, metadata)
SELECT
    plan_id,
    feature_id,
    boolean_value,
    integer_value,
    decimal_value,
    string_value,
    '{}'::jsonb
FROM entitlement_values
ON CONFLICT (plan_id, feature_id) DO UPDATE
SET boolean_value = EXCLUDED.boolean_value,
    integer_value = EXCLUDED.integer_value,
    decimal_value = EXCLUDED.decimal_value,
    string_value = EXCLUDED.string_value,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- =============================================================================
-- 5. ADDONS
-- =============================================================================

WITH addon_seed(key, name, description, category, target_module, target_feature_key, available_in_tiers, not_available_in_tiers, is_active, sort_order) AS (
VALUES
    ('session_replay', 'Session Replay', 'Record and replay user sessions', 'module', 'session_replay', 'module_session_replay_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 1),
    ('profiling', 'Profiling', 'CPU and memory profiling', 'module', 'profiling', 'module_profiling_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 2),
    ('cron_monitoring', 'Cron Monitoring', 'Monitor scheduled job execution', 'module', 'cron_monitoring', 'module_cron_monitoring_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 3),
    ('uptime_monitoring', 'Uptime Monitoring', 'Synthetic checks and status pages', 'module', 'uptime_monitoring', 'module_uptime_monitoring_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 4),
    ('ai_credits', 'AI Credits Pack', 'Additional AI analysis credits', 'capacity', 'ai_insights', 'module_ai_insights_monthly_credits', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 5),
    ('extra_events', 'Extra Events', 'Additional monthly event volume', 'capacity', NULL, 'monthly_events', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 6),
    ('extra_projects', 'Extra Projects', 'Add more projects', 'capacity', NULL, 'limit_projects_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 7),
    ('extra_members', 'Extra Members', 'Add more team members', 'capacity', NULL, 'limit_members_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 8),
    ('extra_connectors', 'Extra Connectors', 'Add more alert connectors', 'capacity', NULL, 'limit_connectors_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 9),
    ('extra_alert_rules', 'Extra Alert Rules', 'Add more custom alert rules', 'capacity', NULL, 'limit_alert_rules_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 10),
    ('extended_retention', 'Extended Retention', 'Extend data retention period', 'capacity', NULL, NULL, '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 11),
    ('private_networking', 'Private Networking', 'VPC peering and private endpoints', 'enterprise_feature', 'enterprise', 'module_enterprise_features_private_networking', '{business}'::billing_plan_tier[], '{free,starter,growth,enterprise}'::billing_plan_tier[], TRUE, 12),
    ('custom_domains', 'Custom Domains', 'Use your own domain', 'enterprise_feature', 'enterprise', 'module_enterprise_features_custom_domains', '{growth,business}'::billing_plan_tier[], '{free,starter,enterprise}'::billing_plan_tier[], TRUE, 13)
)
INSERT INTO addons
    (key, name, description, category, target_module, target_feature_id, available_in_tiers, not_available_in_tiers, is_active, sort_order, metadata)
SELECT
    a.key,
    a.name,
    a.description,
    a.category,
    a.target_module,
    bf.id,
    a.available_in_tiers,
    a.not_available_in_tiers,
    a.is_active,
    a.sort_order,
    '{}'::jsonb
FROM addon_seed a
LEFT JOIN billing_features bf
  ON bf.feature_key = a.target_feature_key
 AND bf.deleted_at IS NULL
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    target_module = EXCLUDED.target_module,
    target_feature_id = EXCLUDED.target_feature_id,
    available_in_tiers = EXCLUDED.available_in_tiers,
    not_available_in_tiers = EXCLUDED.not_available_in_tiers,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

-- =============================================================================
-- 6. ADDON PRICES
-- =============================================================================

WITH addon_price_seed(addon_key, provider, billing_interval, currency, amount_minor, pricing_model, unit_quantity, unit_label, is_default) AS (
VALUES
    ('session_replay', 'stripe', 'monthly', 'USD', 2900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('profiling', 'stripe', 'monthly', 'USD', 1900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('cron_monitoring', 'stripe', 'monthly', 'USD', 1500::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('uptime_monitoring', 'stripe', 'monthly', 'USD', 2500::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('ai_credits', 'stripe', 'monthly', 'USD', 1000::bigint, 'per_unit', 1000::integer, 'credits', TRUE),
    ('extra_events', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 100000::integer, 'events', TRUE),
    ('extra_projects', 'stripe', 'monthly', 'USD', 1000::bigint, 'per_unit', 5::integer, 'projects', TRUE),
    ('extra_members', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 5::integer, 'members', TRUE),
    ('extra_connectors', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 5::integer, 'connectors', TRUE),
    ('extra_alert_rules', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 25::integer, 'rules', TRUE),
    ('extended_retention', 'stripe', 'monthly', 'USD', 2000::bigint, 'per_unit', 30::integer, 'days', TRUE),
    ('private_networking', 'stripe', 'monthly', 'USD', 19900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('custom_domains', 'stripe', 'monthly', 'USD', 4900::bigint, 'per_unit', 1::integer, 'domain', TRUE)
),
resolved_addon_prices AS (
    SELECT
        a.id AS addon_id,
        aps.provider::billing_provider_type AS provider,
        aps.billing_interval::billing_interval_type AS billing_interval,
        aps.currency,
        aps.amount_minor,
        NULL::text AS provider_price_id,
        aps.pricing_model,
        aps.unit_quantity,
        aps.unit_label,
        aps.is_default,
        '-infinity'::timestamptz AS starts_at,
        NULL::timestamptz AS ends_at
    FROM addon_price_seed aps
    JOIN addons a
      ON a.key = aps.addon_key
),
updated_addon_prices AS (
    UPDATE addon_prices ap
    SET amount_minor = rap.amount_minor,
        provider_price_id = rap.provider_price_id,
        pricing_model = rap.pricing_model,
        unit_quantity = rap.unit_quantity,
        unit_label = rap.unit_label,
        is_default = rap.is_default,
        ends_at = rap.ends_at,
        updated_at = NOW()
    FROM resolved_addon_prices rap
    WHERE ap.addon_id = rap.addon_id
      AND ap.provider = rap.provider
      AND ap.billing_interval = rap.billing_interval
      AND ap.currency = rap.currency
    RETURNING ap.addon_id, ap.provider, ap.billing_interval, ap.currency
)
INSERT INTO addon_prices
    (addon_id, provider, billing_interval, currency, amount_minor, provider_price_id, pricing_model, unit_quantity, unit_label, is_default, starts_at, ends_at)
SELECT
    rap.addon_id,
    rap.provider,
    rap.billing_interval,
    rap.currency,
    rap.amount_minor,
    rap.provider_price_id,
    rap.pricing_model,
    rap.unit_quantity,
    rap.unit_label,
    rap.is_default,
    rap.starts_at,
    rap.ends_at
FROM resolved_addon_prices rap
WHERE NOT EXISTS (
    SELECT 1
    FROM updated_addon_prices uap
    WHERE uap.addon_id = rap.addon_id
      AND uap.provider = rap.provider
      AND uap.billing_interval = rap.billing_interval
      AND uap.currency = rap.currency
)
ON CONFLICT (addon_id, provider, billing_interval, currency, starts_at) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    provider_price_id = EXCLUDED.provider_price_id,
    pricing_model = EXCLUDED.pricing_model,
    unit_quantity = EXCLUDED.unit_quantity,
    unit_label = EXCLUDED.unit_label,
    is_default = EXCLUDED.is_default,
    ends_at = EXCLUDED.ends_at,
    updated_at = NOW();

COMMIT;

-- VALIDATION CHECKLIST
-- [x] All 5 plans inserted
-- [x] All 6 plan prices inserted
-- [x] All 116 billing_features inserted
-- [x] All 5 plan entitlement matrices inserted across the explicit feature catalog
-- [x] All 13 addons inserted
-- [x] All 13 addon_prices inserted
-- [x] No hardcoded UUIDs anywhere
-- [x] All monetary values are in minor units (cents)
-- [x] All INSERT statements include ON CONFLICT clauses
-- [x] Enterprise plan uses -1 for unlimited integer values
-- [x] NULL string values use explicit NULL::text
