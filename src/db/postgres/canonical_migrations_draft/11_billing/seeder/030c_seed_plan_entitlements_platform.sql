-- =============================================================================
-- Module      : Billing
-- Migration   : 030c_seed_plan_entitlements_platform.sql
-- Description : Seed platform feature entitlements (Dashboards, Alerting, AI,
--               Integrations, Enterprise Security)
-- =============================================================================

BEGIN;

WITH entitlement_seed(plan_key, feature_key, bool_value, int_value) AS (
VALUES
-- ================= FREE =================
('free','dashboards.enabled',TRUE,NULL),
('free','alerting.enabled',FALSE,NULL),
('free','ai.enabled',FALSE,NULL),
('free','integrations.rest_api',TRUE,NULL),

-- ================= STARTER =================
('starter','dashboards.enabled',TRUE,NULL),
('starter','dashboards.custom_dashboards',TRUE,NULL),
('starter','analytics.explorer',TRUE,NULL),
('starter','alerting.enabled',TRUE,NULL),
('starter','alerting.rules',TRUE,NULL),
('starter','alerting.managed_email_fallback',TRUE,NULL),
('starter','integrations.email',TRUE,NULL),
('starter','integrations.webhook',TRUE,NULL),
('starter','integrations.slack',TRUE,NULL),
('starter','quota.dashboards',NULL,10),
('starter','quota.alert_rules',NULL,10),
('starter','quota.daily_alerts',NULL,100),
('starter','quota.monthly_alerts',NULL,1000),
('starter','quota.connector_sends',NULL,1000),

-- ================= GROWTH =================
('growth','dashboards.enabled',TRUE,NULL),
('growth','dashboards.custom_dashboards',TRUE,NULL),
('growth','dashboards.custom_widgets',TRUE,NULL),
('growth','analytics.explorer',TRUE,NULL),
('growth','analytics.query_builder',TRUE,NULL),
('growth','alerting.enabled',TRUE,NULL),
('growth','alerting.composite',TRUE,NULL),
('growth','alerting.escalation_policies',TRUE,NULL),
('growth','alerting.managed_email_fallback',TRUE,NULL),
('growth','ai.enabled',TRUE,NULL),
('growth','ai.summaries',TRUE,NULL),
('growth','integrations.github',TRUE,NULL),
('growth','integrations.jira',TRUE,NULL),
('growth','integrations.slack',TRUE,NULL),
('growth','integrations.discord',TRUE,NULL),
('growth','integrations.email',TRUE,NULL),
('growth','integrations.webhook',TRUE,NULL),
('growth','quota.dashboards',NULL,50),
('growth','quota.alert_rules',NULL,50),
('growth','quota.daily_alerts',NULL,1000),
('growth','quota.monthly_alerts',NULL,25000),
('growth','quota.connector_sends',NULL,25000),
('growth','quota.ai_credits',NULL,5000),

-- ================= BUSINESS =================
('business','dashboards.enabled',TRUE,NULL),
('business','dashboards.embeds',TRUE,NULL),
('business','dashboards.scheduled_reports',TRUE,NULL),
('business','alerting.enabled',TRUE,NULL),
('business','alerting.composite',TRUE,NULL),
('business','alerting.escalation_policies',TRUE,NULL),
('business','alerting.on_call',TRUE,NULL),
('business','alerting.incident_timeline',TRUE,NULL),
('business','alerting.managed_email_fallback',TRUE,NULL),
('business','ai.enabled',TRUE,NULL),
('business','ai.root_cause_analysis',TRUE,NULL),
('business','ai.anomaly_detection',TRUE,NULL),
('business','ai.forecasting',TRUE,NULL),
('business','security.enabled',TRUE,NULL),
('business','security.audit_logs',TRUE,NULL),
('business','security.sso',TRUE,NULL),
('business','integrations.github',TRUE,NULL),
('business','integrations.gitlab',TRUE,NULL),
('business','integrations.terraform',TRUE,NULL),
('business','integrations.email',TRUE,NULL),
('business','integrations.slack',TRUE,NULL),
('business','integrations.discord',TRUE,NULL),
('business','integrations.webhook',TRUE,NULL),
('business','integrations.pagerduty',TRUE,NULL),
('business','integrations.sms',TRUE,NULL),
('business','quota.dashboards',NULL,200),
('business','quota.alert_rules',NULL,250),
('business','quota.daily_alerts',NULL,10000),
('business','quota.monthly_alerts',NULL,250000),
('business','quota.connector_sends',NULL,250000),
('business','quota.ai_credits',NULL,50000),

-- ================= ENTERPRISE =================
('enterprise','dashboards.enabled',TRUE,NULL),
('enterprise','dashboards.embeds',TRUE,NULL),
('enterprise','dashboards.public_links',TRUE,NULL),
('enterprise','dashboards.scheduled_reports',TRUE,NULL),
('enterprise','alerting.enabled',TRUE,NULL),
('enterprise','alerting.composite',TRUE,NULL),
('enterprise','alerting.escalation_policies',TRUE,NULL),
('enterprise','alerting.on_call',TRUE,NULL),
('enterprise','alerting.incident_timeline',TRUE,NULL),
('enterprise','alerting.managed_email_fallback',TRUE,NULL),
('enterprise','ai.enabled',TRUE,NULL),
('enterprise','ai.root_cause_analysis',TRUE,NULL),
('enterprise','ai.anomaly_detection',TRUE,NULL),
('enterprise','ai.forecasting',TRUE,NULL),
('enterprise','ai.incident_copilot',TRUE,NULL),
('enterprise','security.enabled',TRUE,NULL),
('enterprise','security.sso',TRUE,NULL),
('enterprise','security.scim',TRUE,NULL),
('enterprise','security.audit_logs',TRUE,NULL),
('enterprise','security.custom_roles',TRUE,NULL),
('enterprise','security.byok',TRUE,NULL),
('enterprise','integrations.github',TRUE,NULL),
('enterprise','integrations.gitlab',TRUE,NULL),
('enterprise','integrations.bitbucket',TRUE,NULL),
('enterprise','integrations.terraform',TRUE,NULL),
('enterprise','integrations.custom_llm',TRUE,NULL),
('enterprise','integrations.email',TRUE,NULL),
('enterprise','integrations.slack',TRUE,NULL),
('enterprise','integrations.discord',TRUE,NULL),
('enterprise','integrations.microsoft_teams',TRUE,NULL),
('enterprise','integrations.webhook',TRUE,NULL),
('enterprise','integrations.pagerduty',TRUE,NULL),
('enterprise','integrations.sms',TRUE,NULL),
('enterprise','quota.dashboards',NULL,1000),
('enterprise','quota.alert_rules',NULL,1000),
('enterprise','quota.daily_alerts',NULL,100000),
('enterprise','quota.monthly_alerts',NULL,1000000),
('enterprise','quota.connector_sends',NULL,1000000),
('enterprise','quota.ai_credits',NULL,500000)
)

INSERT INTO plan_feature_entitlements
(plan_id, feature_id, boolean_value, integer_value)
SELECT
    p.id,
    f.id,
    e.bool_value,
    e.int_value
FROM entitlement_seed e
JOIN plans p ON p.key = e.plan_key
JOIN billing_features f ON f.feature_key = e.feature_key
ON CONFLICT (plan_id, feature_id)
DO UPDATE SET
    boolean_value = EXCLUDED.boolean_value,
    integer_value = EXCLUDED.integer_value,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;
