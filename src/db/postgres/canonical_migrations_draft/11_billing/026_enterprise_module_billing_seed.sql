-- =============================================================================
-- Module      : Billing
-- Migration   : 026_enterprise_module_billing_seed.sql
-- Description : Enterprise-grade module billing catalog and entitlement matrix
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

-- This seed only manages global catalog data. It intentionally does not create
-- organizations, subscriptions, usage rows, or org overrides. Org creation stays
-- single-organization at the product layer and is represented here as a plan
-- entitlement limit of one organization per account.

-- =============================================================================
-- 1. PLAN CATALOG
-- =============================================================================

INSERT INTO plans
    (key, version, name, tier, description, trial_days, is_active, is_public, sort_order)
VALUES
    ('free', 1, 'Free', 'free', 'Single-organization starter tier for development and evaluation.', 0, TRUE, TRUE, 1),
    ('starter', 1, 'Starter', 'starter', 'Single-organization tier for small production teams.', 14, TRUE, TRUE, 2),
    ('growth', 1, 'Growth', 'growth', 'Single-organization tier for growing teams with advanced observability.', 14, TRUE, TRUE, 3),
    ('business', 1, 'Business', 'business', 'Single-organization tier for security, scale, and operational control.', 14, TRUE, TRUE, 4),
    ('enterprise', 1, 'Enterprise', 'enterprise', 'Single-organization custom tier for maximum scale, governance, and support.', 30, TRUE, FALSE, 5)
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

WITH price_seed(plan_key, provider, billing_interval, currency, amount_minor, is_default, metadata) AS (
VALUES
    ('starter', 'stripe', 'monthly', 'USD', 2900::bigint, TRUE,  '{"display":"$29/mo","catalog":"enterprise-module-v1"}'::jsonb),
    ('starter', 'stripe', 'annual',  'USD', 29000::bigint, FALSE, '{"display":"$290/yr","catalog":"enterprise-module-v1"}'::jsonb),
    ('growth',  'stripe', 'monthly', 'USD', 9900::bigint, TRUE,  '{"display":"$99/mo","catalog":"enterprise-module-v1"}'::jsonb),
    ('growth',  'stripe', 'annual',  'USD', 99000::bigint, FALSE, '{"display":"$990/yr","catalog":"enterprise-module-v1"}'::jsonb),
    ('business','stripe', 'monthly', 'USD', 29900::bigint, TRUE,  '{"display":"$299/mo","catalog":"enterprise-module-v1"}'::jsonb),
    ('business','stripe', 'annual',  'USD', 299000::bigint, FALSE,'{"display":"$2990/yr","catalog":"enterprise-module-v1"}'::jsonb)
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
    ps.metadata
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
-- 2. MODULE-WISE FEATURE MATRIX
-- =============================================================================

CREATE TEMP TABLE tmp_enterprise_billing_feature_seed
(
    feature_key     VARCHAR(100) PRIMARY KEY,
    feature_name    VARCHAR(150) NOT NULL,
    description     TEXT,
    category        billing_feature_category NOT NULL,
    value_type      billing_feature_value_type NOT NULL,
    module          VARCHAR(50),
    is_module_root  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    free_value      TEXT NOT NULL,
    starter_value   TEXT NOT NULL,
    growth_value    TEXT NOT NULL,
    business_value  TEXT NOT NULL,
    enterprise_value TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

INSERT INTO tmp_enterprise_billing_feature_seed
    (feature_key, feature_name, description, category, value_type, module, is_module_root, sort_order,
     free_value, starter_value, growth_value, business_value, enterprise_value, metadata)
VALUES
-- Core limits and reset policies.
('limit_organizations_max','Organizations','Maximum organizations per account. Product policy is single organization only.','limits','integer','organization',FALSE,1,'1','1','1','1','1','{"frontendGroup":"limits","reset":"never","enforcement":"account"}'),
('monthly_events','Monthly Events','Total accepted events per billing period.','limits','integer','limits',FALSE,2,'5000','100000','1000000','5000000','-1','{"frontendGroup":"limits","reset":"monthly","meter":"events"}'),
('limit_projects_max','Projects','Maximum active projects.','limits','integer','projects',FALSE,3,'3','10','25','50','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_members_max','Members','Maximum organization members.','limits','integer','organization',FALSE,4,'1','5','20','100','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_api_keys_max','API Keys','Maximum active API keys.','limits','integer','sdk',FALSE,5,'2','10','25','100','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_connectors_max','Connectors','Maximum configured alert and workflow connectors.','limits','integer','connectors',FALSE,6,'1','3','10','50','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_alert_rules_max','Alert Rules','Maximum active alert rules.','limits','integer','alerting',FALSE,7,'5','25','100','500','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_workflows_max','Workflows','Maximum automation workflows.','limits','integer','automation',FALSE,8,'0','5','25','200','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_dashboards_max','Dashboards','Maximum custom dashboards.','limits','integer','analytics',FALSE,9,'1','5','25','100','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_environments_max','Environments','Maximum environments per organization.','limits','integer','projects',FALSE,10,'2','5','10','25','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_releases_max','Releases','Maximum tracked releases per month.','limits','integer','version_management',FALSE,11,'3','25','100','500','-1','{"frontendGroup":"limits","reset":"monthly"}'),
('limit_monitors_max','Monitors','Maximum uptime and cron monitors.','limits','integer','monitoring',FALSE,12,'5','50','250','1000','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_status_pages_max','Status Pages','Maximum public or private status pages.','limits','integer','uptime_monitoring',FALSE,13,'0','1','5','20','-1','{"frontendGroup":"limits","reset":"never"}'),
('limit_saved_views_max','Saved Views','Maximum saved operational views.','limits','integer','analytics',FALSE,14,'3','25','100','500','-1','{"frontendGroup":"limits","reset":"never"}'),

-- Error tracking.
('module_error_tracking_enabled','Error Tracking','Capture, group, and triage application errors.','monitoring','boolean','error_tracking',TRUE,100,'true','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_retention_days','Error Retention Days','Retention window for error events.','monitoring','integer','error_tracking',FALSE,101,'7','30','60','90','-1','{"frontendGroup":"errorTracking","reset":"rolling"}'),
('module_error_tracking_features_issue_grouping','Issue Grouping','Automatic grouping of related errors.','monitoring','boolean','error_tracking',FALSE,102,'true','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_release_tracking','Release Tracking','Associate errors with releases and deploys.','monitoring','boolean','error_tracking',FALSE,103,'false','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_source_maps','Source Maps','Upload and resolve source maps.','monitoring','boolean','error_tracking',FALSE,104,'false','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_breadcrumbs','Breadcrumbs','Show user and system breadcrumbs before errors.','monitoring','boolean','error_tracking',FALSE,105,'true','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_user_feedback','User Feedback','Collect user feedback attached to issues.','monitoring','boolean','error_tracking',FALSE,106,'false','true','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_ownership','Issue Ownership','Route issues using ownership rules.','monitoring','boolean','error_tracking',FALSE,107,'false','false','true','true','true','{"frontendGroup":"errorTracking"}'),
('module_error_tracking_features_suspect_commits','Suspect Commits','Correlate errors with commits and deploys.','monitoring','boolean','error_tracking',FALSE,108,'false','false','true','true','true','{"frontendGroup":"errorTracking"}'),

-- Distributed tracing.
('module_distributed_tracing_enabled','Distributed Tracing','Trace requests across services.','monitoring','boolean','distributed_tracing',TRUE,120,'true','true','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_retention_days','Trace Retention Days','Retention window for trace data.','monitoring','integer','distributed_tracing',FALSE,121,'3','14','30','30','-1','{"frontendGroup":"tracing","reset":"rolling"}'),
('module_distributed_tracing_features_trace_view','Trace View','Waterfall trace visualization.','monitoring','boolean','distributed_tracing',FALSE,122,'true','true','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_features_span_details','Span Details','Detailed span attributes and timings.','monitoring','boolean','distributed_tracing',FALSE,123,'false','true','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_features_performance_insights','Performance Insights','Highlight slow paths and bottlenecks.','monitoring','boolean','distributed_tracing',FALSE,124,'false','true','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_features_distributed_correlation','Distributed Correlation','Correlate traces with logs, errors, metrics, and deploys.','monitoring','boolean','distributed_tracing',FALSE,125,'false','false','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_features_service_map','Service Map','Topology map generated from traces.','monitoring','boolean','distributed_tracing',FALSE,126,'false','false','true','true','true','{"frontendGroup":"tracing"}'),
('module_distributed_tracing_features_sampling_controls','Trace Sampling Controls','Configure trace sampling from the product.','monitoring','boolean','distributed_tracing',FALSE,127,'false','false','true','true','true','{"frontendGroup":"tracing"}'),

-- Logging.
('module_logging_enabled','Logging','Ingest, search, and analyze structured logs.','monitoring','boolean','logging',TRUE,140,'true','true','true','true','true','{"frontendGroup":"logging"}'),
('module_logging_retention_days','Log Retention Days','Retention window for logs.','monitoring','integer','logging',FALSE,141,'3','14','30','30','-1','{"frontendGroup":"logging","reset":"rolling"}'),
('module_logging_features_log_search','Log Search','Search ingested logs.','monitoring','boolean','logging',FALSE,142,'true','true','true','true','true','{"frontendGroup":"logging"}'),
('module_logging_features_log_patterns','Log Patterns','Detect and group recurring log patterns.','monitoring','boolean','logging',FALSE,143,'false','true','true','true','true','{"frontendGroup":"logging"}'),
('module_logging_features_structured_parsing','Structured Parsing','Parse JSON and structured log fields.','monitoring','boolean','logging',FALSE,144,'true','true','true','true','true','{"frontendGroup":"logging"}'),
('module_logging_features_live_tail','Live Tail','Stream logs in near real time.','monitoring','boolean','logging',FALSE,145,'false','false','true','true','true','{"frontendGroup":"logging"}'),
('module_logging_features_sensitive_data_scrubbing','Sensitive Data Scrubbing','Scrub configured sensitive fields from logs.','monitoring','boolean','logging',FALSE,146,'false','false','true','true','true','{"frontendGroup":"logging"}'),

-- Metrics and profiling.
('module_metrics_enabled','Metrics','Collect and query operational metrics.','monitoring','boolean','metrics',TRUE,160,'true','true','true','true','true','{"frontendGroup":"metrics"}'),
('module_metrics_retention_days','Metrics Retention Days','Retention window for metrics.','monitoring','integer','metrics',FALSE,161,'7','30','90','365','-1','{"frontendGroup":"metrics","reset":"rolling"}'),
('module_metrics_features_custom_dashboards','Metric Dashboards','Build dashboards from metric queries.','monitoring','boolean','metrics',FALSE,162,'false','false','true','true','true','{"frontendGroup":"metrics"}'),
('module_metrics_features_metric_alerts','Metric Alerts','Trigger alerts from metric thresholds.','monitoring','boolean','metrics',FALSE,163,'false','true','true','true','true','{"frontendGroup":"metrics"}'),
('module_metrics_features_derived_metrics','Derived Metrics','Create metrics from formulas and transforms.','monitoring','boolean','metrics',FALSE,164,'false','false','true','true','true','{"frontendGroup":"metrics"}'),
('module_metrics_features_metric_export','Metric Export','Export metrics to external destinations.','monitoring','boolean','metrics',FALSE,165,'false','false','true','true','true','{"frontendGroup":"metrics"}'),
('module_metrics_features_cardinality_management','Cardinality Management','Control high-cardinality metric dimensions.','monitoring','boolean','metrics',FALSE,166,'false','false','true','true','true','{"frontendGroup":"metrics"}'),
('module_profiling_enabled','Profiling','CPU and memory profiling.','monitoring','boolean','profiling',TRUE,180,'false','false','true','true','true','{"frontendGroup":"profiling"}'),
('module_profiling_retention_days','Profiling Retention Days','Retention window for profiles.','monitoring','integer','profiling',FALSE,181,'0','0','14','30','-1','{"frontendGroup":"profiling","reset":"rolling"}'),
('module_profiling_features_flame_graphs','Flame Graphs','Inspect CPU and memory flame graphs.','monitoring','boolean','profiling',FALSE,182,'false','false','true','true','true','{"frontendGroup":"profiling"}'),
('module_profiling_features_differential_profiling','Differential Profiling','Compare profiles across releases.','monitoring','boolean','profiling',FALSE,183,'false','false','true','true','true','{"frontendGroup":"profiling"}'),
('module_profiling_features_code_hotspots','Code Hotspots','Surface expensive functions and code paths.','monitoring','boolean','profiling',FALSE,184,'false','false','true','true','true','{"frontendGroup":"profiling"}'),

-- Session replay, cron, and uptime monitoring.
('module_session_replay_enabled','Session Replay','Record and replay browser sessions.','monitoring','boolean','session_replay',TRUE,200,'false','false','true','true','true','{"frontendGroup":"sessionReplay"}'),
('module_session_replay_retention_days','Replay Retention Days','Retention window for session replays.','monitoring','integer','session_replay',FALSE,201,'0','0','14','30','-1','{"frontendGroup":"sessionReplay","reset":"rolling"}'),
('module_session_replay_features_rrweb_playback','Replay Playback','Replay captured browser sessions.','monitoring','boolean','session_replay',FALSE,202,'false','false','true','true','true','{"frontendGroup":"sessionReplay"}'),
('module_session_replay_features_rage_clicks','Rage Clicks','Detect repeated frustrated clicks.','monitoring','boolean','session_replay',FALSE,203,'false','false','true','true','true','{"frontendGroup":"sessionReplay"}'),
('module_session_replay_features_dead_clicks','Dead Clicks','Detect ineffective interactions.','monitoring','boolean','session_replay',FALSE,204,'false','false','true','true','true','{"frontendGroup":"sessionReplay"}'),
('module_session_replay_features_privacy_masking','Privacy Masking','Mask sensitive user data in recordings.','monitoring','boolean','session_replay',FALSE,205,'false','false','true','true','true','{"frontendGroup":"sessionReplay"}'),
('module_cron_monitoring_enabled','Cron Monitoring','Monitor recurring jobs and schedules.','monitoring','boolean','cron_monitoring',TRUE,220,'false','true','true','true','true','{"frontendGroup":"cronMonitoring"}'),
('module_cron_monitoring_features_job_scheduling','Job Scheduling','Register expected schedules for background jobs.','monitoring','boolean','cron_monitoring',FALSE,221,'false','true','true','true','true','{"frontendGroup":"cronMonitoring"}'),
('module_cron_monitoring_features_missed_job_detection','Missed Job Detection','Detect missing executions.','monitoring','boolean','cron_monitoring',FALSE,222,'false','true','true','true','true','{"frontendGroup":"cronMonitoring"}'),
('module_cron_monitoring_features_job_duration_tracking','Job Duration Tracking','Track runtime and overrun behavior.','monitoring','boolean','cron_monitoring',FALSE,223,'false','true','true','true','true','{"frontendGroup":"cronMonitoring"}'),
('module_uptime_monitoring_enabled','Uptime Monitoring','Synthetic uptime checks and status pages.','monitoring','boolean','uptime_monitoring',TRUE,240,'false','true','true','true','true','{"frontendGroup":"uptimeMonitoring"}'),
('module_uptime_monitoring_features_synthetic_checks','Synthetic Checks','Run HTTP synthetic monitors.','monitoring','boolean','uptime_monitoring',FALSE,241,'false','true','true','true','true','{"frontendGroup":"uptimeMonitoring"}'),
('module_uptime_monitoring_features_multi_region','Multi-region Checks','Run checks from multiple regions.','monitoring','boolean','uptime_monitoring',FALSE,242,'false','false','true','true','true','{"frontendGroup":"uptimeMonitoring"}'),
('module_uptime_monitoring_features_ssl_monitoring','SSL Monitoring','Track certificate expiry and TLS health.','monitoring','boolean','uptime_monitoring',FALSE,243,'false','true','true','true','true','{"frontendGroup":"uptimeMonitoring"}'),
('module_uptime_monitoring_features_status_page','Status Page','Publish service status pages.','monitoring','boolean','uptime_monitoring',FALSE,244,'false','false','true','true','true','{"frontendGroup":"uptimeMonitoring"}'),

-- Version and incident management.
('module_version_management_enabled','Version Management','Track releases, deploys, and release health.','projects','boolean','version_management',TRUE,300,'true','true','true','true','true','{"frontendGroup":"versionManagement"}'),
('module_version_management_features_deploy_tracking','Deploy Tracking','Track deploys by environment and project.','projects','boolean','version_management',FALSE,301,'true','true','true','true','true','{"frontendGroup":"versionManagement"}'),
('module_version_management_features_release_health','Release Health','Monitor regressions after release.','projects','boolean','version_management',FALSE,302,'false','true','true','true','true','{"frontendGroup":"versionManagement"}'),
('module_version_management_features_regression_detection','Regression Detection','Detect release regressions from telemetry.','projects','boolean','version_management',FALSE,303,'false','false','true','true','true','{"frontendGroup":"versionManagement"}'),
('module_version_management_features_changelog_annotations','Changelog Annotations','Annotate dashboards and incidents with release notes.','projects','boolean','version_management',FALSE,304,'false','false','true','true','true','{"frontendGroup":"versionManagement"}'),
('module_version_management_features_release_gates','Release Gates','Block or warn on unhealthy release gates.','projects','boolean','version_management',FALSE,305,'false','false','false','true','true','{"frontendGroup":"versionManagement"}'),
('module_incident_management_enabled','Incident Management','Create and manage operational incidents.','alerts','boolean','incident_management',TRUE,320,'false','true','true','true','true','{"frontendGroup":"incidentManagement"}'),
('module_incident_management_features_timelines','Incident Timelines','Build incident timelines from telemetry and actions.','alerts','boolean','incident_management',FALSE,321,'false','true','true','true','true','{"frontendGroup":"incidentManagement"}'),
('module_incident_management_features_root_cause','Root Cause Analysis','Correlate incidents with telemetry and deploys.','alerts','boolean','incident_management',FALSE,322,'false','false','true','true','true','{"frontendGroup":"incidentManagement"}'),
('module_incident_management_features_postmortems','Postmortems','Create postmortems from incidents.','alerts','boolean','incident_management',FALSE,323,'false','false','true','true','true','{"frontendGroup":"incidentManagement"}'),
('module_incident_management_features_on_call_routing','On-call Routing','Route incidents to escalation targets.','alerts','boolean','incident_management',FALSE,324,'false','false','false','true','true','{"frontendGroup":"incidentManagement"}'),

-- AI insights.
('module_ai_insights_enabled','AI Insights','AI-powered analysis across errors, traces, logs, and incidents.','ai','boolean','ai_insights',TRUE,400,'false','true','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_monthly_credits','AI Credits','Monthly AI analysis credits.','ai','integer','ai_insights',FALSE,401,'0','500','2500','10000','-1','{"frontendGroup":"aiInsights","reset":"monthly","meter":"ai_credits"}'),
('module_ai_insights_features_error_explanation','Error Explanation','Explain errors using context and stack traces.','ai','boolean','ai_insights',FALSE,402,'false','true','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_root_cause_analysis','Root Cause Analysis','Suggest likely causes across telemetry.','ai','boolean','ai_insights',FALSE,403,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_stack_trace_analysis','Stack Trace Analysis','Analyze stack traces and source context.','ai','boolean','ai_insights',FALSE,404,'false','true','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_trace_analysis','Trace Analysis','Analyze traces and latency bottlenecks.','ai','boolean','ai_insights',FALSE,405,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_span_analysis','Span Analysis','Analyze individual spans and attributes.','ai','boolean','ai_insights',FALSE,406,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_suggested_fixes','Suggested Fixes','Generate fix recommendations.','ai','boolean','ai_insights',FALSE,407,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_sql_optimization','SQL Optimization','Analyze slow SQL from traces.','ai','boolean','ai_insights',FALSE,408,'false','false','false','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_log_summary','Log Summary','Summarize log clusters and incidents.','ai','boolean','ai_insights',FALSE,409,'false','true','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_deployment_correlation','Deployment Correlation','Correlate telemetry changes with deploys.','ai','boolean','ai_insights',FALSE,410,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_incident_summary','Incident Summary','Generate incident summaries.','ai','boolean','ai_insights',FALSE,411,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_weekly_report','Weekly Report','Generate weekly engineering health reports.','ai','boolean','ai_insights',FALSE,412,'false','false','false','true','true','{"frontendGroup":"aiInsights"}'),
('module_ai_insights_features_chat_assistant','Chat Assistant','Ask questions across telemetry.','ai','boolean','ai_insights',FALSE,413,'false','false','true','true','true','{"frontendGroup":"aiInsights"}'),

-- Alerting and connectors.
('module_alerting_enabled','Alerting','Rules, notifications, deduplication, and escalation.','alerts','boolean','alerting',TRUE,500,'true','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_basic_email','Email Alerts','Send email alerts.','alerts','boolean','alerting',FALSE,501,'true','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_multi_channel','Multi-channel Alerts','Send alerts through multiple channels.','alerts','boolean','alerting',FALSE,502,'false','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_escalation_policies','Escalation Policies','Escalate unresolved alerts.','alerts','boolean','alerting',FALSE,503,'false','false','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_deduplication','Alert Deduplication','Deduplicate repeated alerts.','alerts','boolean','alerting',FALSE,504,'false','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_silencing','Alert Silencing','Silence alerts by rule and time window.','alerts','boolean','alerting',FALSE,505,'false','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_throttling','Alert Throttling','Throttle noisy alert streams.','alerts','boolean','alerting',FALSE,506,'false','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_alerting_features_custom_alert_rules','Custom Alert Rules','Create custom alert rules.','alerts','boolean','alerting',FALSE,507,'false','true','true','true','true','{"frontendGroup":"alerting"}'),
('module_connectors_enabled','Connectors','Integrations for notifications and workflows.','integrations','boolean','connectors',TRUE,540,'true','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_sync_audit_logs','Connector Audit Sync','Sync connector activity into audit logs.','integrations','boolean','connectors',FALSE,541,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_multi_channel_per_alert','Multiple Channels Per Alert','Attach multiple connectors to an alert rule.','integrations','boolean','connectors',FALSE,542,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_slack','Slack Connector','Send alerts to Slack.','integrations','boolean','connectors',FALSE,543,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_discord','Discord Connector','Send alerts to Discord.','integrations','boolean','connectors',FALSE,544,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_pagerduty','PagerDuty Connector','Send alerts to PagerDuty.','integrations','boolean','connectors',FALSE,545,'false','false','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_teams','Teams Connector','Send alerts to Microsoft Teams.','integrations','boolean','connectors',FALSE,546,'false','false','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_webhook','Webhook Connector','Send alerts to webhooks.','integrations','boolean','connectors',FALSE,547,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_email','Email Connector','Send alerts to email destinations.','integrations','boolean','connectors',FALSE,548,'true','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_github','GitHub Connector','Create or update GitHub issues.','integrations','boolean','connectors',FALSE,549,'false','true','true','true','true','{"frontendGroup":"connectors"}'),
('module_connectors_features_connector_jira','Jira Connector','Create or update Jira issues.','integrations','boolean','connectors',FALSE,550,'false','false','true','true','true','{"frontendGroup":"connectors"}'),

-- Analytics, SDK, and automation.
('module_analytics_enabled','Analytics','Dashboards, saved views, reports, and exports.','dashboard','boolean','analytics',TRUE,600,'true','true','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_level','Analytics Level','Analytics capability level.','dashboard','string','analytics',FALSE,601,'basic','standard','advanced','advanced','enterprise','{"frontendGroup":"analytics"}'),
('module_analytics_features_real_time','Real-time Analytics','Refresh dashboards in near real time.','dashboard','boolean','analytics',FALSE,602,'false','true','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_custom_dashboards','Custom Dashboards','Create custom dashboards.','dashboard','boolean','analytics',FALSE,603,'false','true','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_data_export','Data Export','Export analytics data.','dashboard','boolean','analytics',FALSE,604,'false','false','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_advanced_filtering','Advanced Filtering','Use advanced filters in analytics views.','dashboard','boolean','analytics',FALSE,605,'false','true','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_comparative_analysis','Comparative Analysis','Compare segments and time windows.','dashboard','boolean','analytics',FALSE,606,'false','false','true','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_trend_forecasting','Trend Forecasting','Forecast operational trends.','dashboard','boolean','analytics',FALSE,607,'false','false','false','true','true','{"frontendGroup":"analytics"}'),
('module_analytics_features_custom_reports','Custom Reports','Create custom scheduled reports.','dashboard','boolean','analytics',FALSE,608,'false','false','false','true','true','{"frontendGroup":"analytics"}'),
('module_sdk_enabled','SDK Controls','SDK ingestion and remote controls.','monitoring','boolean','sdk',TRUE,640,'true','true','true','true','true','{"frontendGroup":"sdk"}'),
('module_sdk_auto_instrumentation','Auto Instrumentation','SDK auto instrumentation level.','monitoring','string','sdk',FALSE,641,'basic','advanced','advanced','pro','pro','{"frontendGroup":"sdk"}'),
('module_sdk_offline_queue','Offline Queue','Buffer telemetry offline.','monitoring','boolean','sdk',FALSE,642,'false','true','true','true','true','{"frontendGroup":"sdk"}'),
('module_sdk_remote_control','Remote SDK Control','Remotely configure SDK behavior.','monitoring','boolean','sdk',FALSE,643,'false','true','true','true','true','{"frontendGroup":"sdk"}'),
('module_sdk_sampling_error_rate','Error Sample Rate','Maximum error sampling rate.','monitoring','decimal','sdk',FALSE,644,'1.0','1.0','1.0','1.0','1.0','{"frontendGroup":"sdk"}'),
('module_sdk_sampling_trace_rate','Trace Sample Rate','Maximum trace sampling rate.','monitoring','decimal','sdk',FALSE,645,'0.1','0.2','0.3','0.5','1.0','{"frontendGroup":"sdk"}'),
('module_sdk_sampling_remotely_configurable','Remote Sampling','Configure SDK sampling remotely.','monitoring','boolean','sdk',FALSE,646,'false','true','true','true','true','{"frontendGroup":"sdk"}'),
('module_sdk_version_pinning','SDK Version Pinning','Pin allowed SDK versions.','monitoring','boolean','sdk',FALSE,647,'false','false','true','true','true','{"frontendGroup":"sdk"}'),
('module_automation_enabled','Automation','Workflow automation for operational actions.','integrations','boolean','automation',TRUE,680,'false','true','true','true','true','{"frontendGroup":"automation"}'),
('module_automation_features_webhooks','Workflow Webhooks','Trigger workflows through webhooks.','integrations','boolean','automation',FALSE,681,'false','true','true','true','true','{"frontendGroup":"automation"}'),
('module_automation_features_scheduled_workflows','Scheduled Workflows','Run workflows on schedules.','integrations','boolean','automation',FALSE,682,'false','false','true','true','true','{"frontendGroup":"automation"}'),
('module_automation_features_approval_steps','Approval Steps','Require approvals in workflows.','integrations','boolean','automation',FALSE,683,'false','false','false','true','true','{"frontendGroup":"automation"}'),

-- Security, enterprise controls, support, and billing operations.
('module_enterprise_enabled','Enterprise Controls','Governance, security, and infrastructure controls.','security','boolean','enterprise',TRUE,800,'false','false','false','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_sso','SSO','SAML or OIDC single sign-on.','security','boolean','enterprise',FALSE,801,'false','false','false','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_scim','SCIM','SCIM user and group provisioning.','security','boolean','enterprise',FALSE,802,'false','false','false','false','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_audit_logs','Audit Logs','Organization audit logs.','security','boolean','enterprise',FALSE,803,'false','false','true','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_custom_retention','Custom Retention','Custom retention policies.','security','boolean','enterprise',FALSE,804,'false','false','false','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_custom_domains','Custom Domains','Custom domains for status pages and shared views.','security','boolean','enterprise',FALSE,805,'false','false','true','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_private_networking','Private Networking','VPC peering and private endpoints.','security','boolean','enterprise',FALSE,806,'false','false','false','false','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_priority_queue','Priority Queue','Priority ingestion and processing queue.','security','boolean','enterprise',FALSE,807,'false','false','true','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_dedicated_workers','Dedicated Workers','Dedicated processing workers.','security','boolean','enterprise',FALSE,808,'false','false','false','false','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_ip_allowlist','IP Allowlist','Restrict access by IP allowlist.','security','boolean','enterprise',FALSE,809,'false','false','false','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_custom_roles','Custom Roles','Create custom RBAC roles.','security','boolean','enterprise',FALSE,810,'false','false','true','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_features_data_export_controls','Data Export Controls','Govern export permissions and destinations.','security','boolean','enterprise',FALSE,811,'false','false','false','true','true','{"frontendGroup":"enterprise"}'),
('module_enterprise_sla','SLA','Service level agreement.','security','string','enterprise',FALSE,812,'none','99.5%','99.9%','99.95%','custom','{"frontendGroup":"enterprise"}'),
('module_enterprise_data_residency','Data Residency','Allowed data residency regions.','security','string','enterprise',FALSE,813,'US','US','US,EU','US,EU,APAC','custom','{"frontendGroup":"enterprise"}'),
('module_support_level','Support Level','Support tier.','organization','string','support',TRUE,900,'community','standard','priority','business','enterprise','{"frontendGroup":"support"}'),
('module_support_response_time','Support Response Time','Target first response time.','organization','string','support',FALSE,901,'best_effort','48h','24h','4h','1h','{"frontendGroup":"support"}'),
('module_support_dedicated_manager','Dedicated Success Manager','Assigned success manager.','organization','boolean','support',FALSE,902,'false','false','false','false','true','{"frontendGroup":"support"}'),
('module_support_onboarding','Onboarding','Assisted onboarding access.','organization','boolean','support',FALSE,903,'false','true','true','true','true','{"frontendGroup":"support"}'),
('module_billing_ops_enabled','Billing Operations','Invoices, payment methods, coupons, and budget controls.','organization','boolean','billing_ops',TRUE,940,'false','true','true','true','true','{"frontendGroup":"billingOps"}'),
('module_billing_ops_invoice_history','Invoice History','Access invoice history.','organization','boolean','billing_ops',FALSE,941,'false','true','true','true','true','{"frontendGroup":"billingOps"}'),
('module_billing_ops_payment_methods','Payment Methods','Manage payment methods.','organization','boolean','billing_ops',FALSE,942,'false','true','true','true','true','{"frontendGroup":"billingOps"}'),
('module_billing_ops_coupons','Coupons','Apply eligible coupons.','organization','boolean','billing_ops',FALSE,943,'false','false','true','true','true','{"frontendGroup":"billingOps"}'),
('module_billing_ops_cost_alerts','Cost Alerts','Alert when projected usage spend crosses thresholds.','organization','boolean','billing_ops',FALSE,944,'false','false','true','true','true','{"frontendGroup":"billingOps"}');

INSERT INTO billing_features
    (feature_key, feature_name, description, category, value_type, module, is_module_root, sort_order, is_billable, is_public, metadata)
SELECT
    fs.feature_key,
    fs.feature_name,
    fs.description,
    fs.category,
    fs.value_type,
    fs.module,
    fs.is_module_root,
    fs.sort_order,
    TRUE,
    TRUE,
    fs.metadata || jsonb_build_object('catalog', 'enterprise-module-v1')
FROM tmp_enterprise_billing_feature_seed fs
ON CONFLICT (feature_key) DO UPDATE
SET feature_name = EXCLUDED.feature_name,
    description = EXCLUDED.description,
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

WITH plan_scope AS (
    SELECT id, key
    FROM plans
    WHERE key IN ('free', 'starter', 'growth', 'business', 'enterprise')
      AND version = 1
      AND deleted_at IS NULL
),
feature_scope AS (
    SELECT bf.id, bf.feature_key, bf.value_type, fs.free_value, fs.starter_value, fs.growth_value, fs.business_value, fs.enterprise_value
    FROM tmp_enterprise_billing_feature_seed fs
    JOIN billing_features bf
      ON bf.feature_key = fs.feature_key
     AND bf.deleted_at IS NULL
),
entitlement_values AS (
    SELECT
        p.id AS plan_id,
        f.id AS feature_id,
        CASE p.key
            WHEN 'free' THEN f.free_value
            WHEN 'starter' THEN f.starter_value
            WHEN 'growth' THEN f.growth_value
            WHEN 'business' THEN f.business_value
            ELSE f.enterprise_value
        END AS plan_value,
        f.value_type
    FROM plan_scope p
    CROSS JOIN feature_scope f
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value, metadata)
SELECT
    ev.plan_id,
    ev.feature_id,
    CASE WHEN ev.value_type = 'boolean' THEN ev.plan_value::boolean END,
    CASE WHEN ev.value_type = 'integer' THEN ev.plan_value::bigint END,
    CASE WHEN ev.value_type = 'decimal' THEN ev.plan_value::numeric(20,6) END,
    CASE WHEN ev.value_type = 'string' THEN ev.plan_value END,
    jsonb_build_object('catalog', 'enterprise-module-v1')
FROM entitlement_values ev
ON CONFLICT (plan_id, feature_id) DO UPDATE
SET boolean_value = EXCLUDED.boolean_value,
    integer_value = EXCLUDED.integer_value,
    decimal_value = EXCLUDED.decimal_value,
    string_value = EXCLUDED.string_value,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();

-- =============================================================================
-- 3. ADD-ONS
-- =============================================================================

WITH addon_seed(key, name, description, category, target_module, target_feature_key, available_in_tiers, not_available_in_tiers, is_active, sort_order, metadata) AS (
VALUES
    ('session_replay', 'Session Replay', 'Record and replay user sessions.', 'module', 'session_replay', 'module_session_replay_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 1, '{"frontendGroup":"sessionReplay"}'::jsonb),
    ('profiling', 'Profiling', 'CPU and memory profiling.', 'module', 'profiling', 'module_profiling_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 2, '{"frontendGroup":"profiling"}'::jsonb),
    ('cron_monitoring', 'Cron Monitoring', 'Scheduled job monitoring.', 'module', 'cron_monitoring', 'module_cron_monitoring_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 3, '{"frontendGroup":"cronMonitoring"}'::jsonb),
    ('uptime_monitoring', 'Uptime Monitoring', 'Synthetic checks and status pages.', 'module', 'uptime_monitoring', 'module_uptime_monitoring_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 4, '{"frontendGroup":"uptimeMonitoring"}'::jsonb),
    ('version_management', 'Version Management', 'Release health and deploy tracking.', 'module', 'version_management', 'module_version_management_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 5, '{"frontendGroup":"versionManagement"}'::jsonb),
    ('incident_management', 'Incident Management', 'Incident timelines, postmortems, and routing.', 'module', 'incident_management', 'module_incident_management_enabled', '{free,starter,growth,business}'::billing_plan_tier[], '{enterprise}'::billing_plan_tier[], TRUE, 6, '{"frontendGroup":"incidentManagement"}'::jsonb),
    ('ai_credits', 'AI Credits Pack', 'Additional monthly AI analysis credits.', 'capacity', 'ai_insights', 'module_ai_insights_monthly_credits', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 20, '{"unit":"credits","reset":"monthly"}'::jsonb),
    ('extra_events', 'Extra Events', 'Additional monthly event volume.', 'capacity', NULL, 'monthly_events', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 21, '{"unit":"events","reset":"monthly"}'::jsonb),
    ('extra_projects', 'Extra Projects', 'Additional active projects.', 'capacity', NULL, 'limit_projects_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 22, '{"unit":"projects","reset":"never"}'::jsonb),
    ('extra_members', 'Extra Members', 'Additional organization members.', 'capacity', NULL, 'limit_members_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 23, '{"unit":"members","reset":"never"}'::jsonb),
    ('extra_connectors', 'Extra Connectors', 'Additional alert connectors.', 'capacity', NULL, 'limit_connectors_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 24, '{"unit":"connectors","reset":"never"}'::jsonb),
    ('extra_alert_rules', 'Extra Alert Rules', 'Additional alert rules.', 'capacity', NULL, 'limit_alert_rules_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 25, '{"unit":"rules","reset":"never"}'::jsonb),
    ('extra_releases', 'Extra Releases', 'Additional tracked releases each month.', 'capacity', NULL, 'limit_releases_max', '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 26, '{"unit":"releases","reset":"monthly"}'::jsonb),
    ('extended_retention', 'Extended Retention', 'Extend telemetry retention windows.', 'capacity', NULL, NULL, '{starter,growth,business}'::billing_plan_tier[], '{free,enterprise}'::billing_plan_tier[], TRUE, 27, '{"unit":"days","reset":"rolling"}'::jsonb),
    ('private_networking', 'Private Networking', 'VPC peering and private endpoints.', 'enterprise_feature', 'enterprise', 'module_enterprise_features_private_networking', '{business}'::billing_plan_tier[], '{free,starter,growth,enterprise}'::billing_plan_tier[], TRUE, 40, '{"frontendGroup":"enterprise"}'::jsonb),
    ('custom_domains', 'Custom Domains', 'Use custom domains for status pages and shared views.', 'enterprise_feature', 'enterprise', 'module_enterprise_features_custom_domains', '{growth,business}'::billing_plan_tier[], '{free,starter,enterprise}'::billing_plan_tier[], TRUE, 41, '{"frontendGroup":"enterprise"}'::jsonb),
    ('data_residency', 'Data Residency', 'Custom data residency commitments.', 'enterprise_feature', 'enterprise', 'module_enterprise_data_residency', '{business}'::billing_plan_tier[], '{free,starter,growth,enterprise}'::billing_plan_tier[], TRUE, 42, '{"frontendGroup":"enterprise"}'::jsonb),
    ('dedicated_workers', 'Dedicated Workers', 'Dedicated processing workers.', 'enterprise_feature', 'enterprise', 'module_enterprise_features_dedicated_workers', '{business}'::billing_plan_tier[], '{free,starter,growth,enterprise}'::billing_plan_tier[], TRUE, 43, '{"frontendGroup":"enterprise"}'::jsonb)
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
    a.metadata || jsonb_build_object('catalog', 'enterprise-module-v1')
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

WITH addon_price_seed(addon_key, provider, billing_interval, currency, amount_minor, pricing_model, unit_quantity, unit_label, is_default) AS (
VALUES
    ('session_replay', 'stripe', 'monthly', 'USD', 2900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('profiling', 'stripe', 'monthly', 'USD', 1900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('cron_monitoring', 'stripe', 'monthly', 'USD', 1500::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('uptime_monitoring', 'stripe', 'monthly', 'USD', 2500::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('version_management', 'stripe', 'monthly', 'USD', 1900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('incident_management', 'stripe', 'monthly', 'USD', 3900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('ai_credits', 'stripe', 'monthly', 'USD', 1000::bigint, 'per_unit', 1000::integer, 'credits', TRUE),
    ('extra_events', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 100000::integer, 'events', TRUE),
    ('extra_projects', 'stripe', 'monthly', 'USD', 1000::bigint, 'per_unit', 5::integer, 'projects', TRUE),
    ('extra_members', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 5::integer, 'members', TRUE),
    ('extra_connectors', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 5::integer, 'connectors', TRUE),
    ('extra_alert_rules', 'stripe', 'monthly', 'USD', 500::bigint, 'per_unit', 25::integer, 'rules', TRUE),
    ('extra_releases', 'stripe', 'monthly', 'USD', 700::bigint, 'per_unit', 25::integer, 'releases', TRUE),
    ('extended_retention', 'stripe', 'monthly', 'USD', 2000::bigint, 'per_unit', 30::integer, 'days', TRUE),
    ('private_networking', 'stripe', 'monthly', 'USD', 19900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('custom_domains', 'stripe', 'monthly', 'USD', 4900::bigint, 'per_unit', 1::integer, 'domain', TRUE),
    ('data_residency', 'stripe', 'monthly', 'USD', 9900::bigint, 'flat', NULL::integer, NULL::text, TRUE),
    ('dedicated_workers', 'stripe', 'monthly', 'USD', 29900::bigint, 'flat', NULL::integer, NULL::text, TRUE)
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
-- [x] Global seed only: no organization, subscription, usage, or override rows.
-- [x] One-organization product policy represented by limit_organizations_max = 1 for every plan.
-- [x] Module-wise feature catalog with frontendGroup metadata for UI grouping.
-- [x] Entitlements are normalized into plan_feature_entitlements for low-latency plan reads.
-- [x] Enterprise unlimited numeric limits use -1 consistently.
-- [x] AI credits and event limits carry monthly reset metadata.
-- [x] Future modules included: version management, incident management, automation, billing operations.
