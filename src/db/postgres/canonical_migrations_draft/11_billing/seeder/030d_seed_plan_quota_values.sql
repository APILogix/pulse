-- =============================================================================
-- Module      : Billing
-- Migration   : 030d_seed_plan_quota_values.sql
-- Description : Seed detailed quota values for all plans
-- =============================================================================

BEGIN;

WITH quota_seed(plan_key, feature_key, integer_value) AS (
VALUES
-- ================= FREE =================
('free','quota.retention_days',7),
('free','quota.log_retention_days',7),
('free','quota.metric_retention_days',7),
('free','quota.profile_retention_days',0),
('free','quota.replay_retention_days',0),
('free','quota.trace_retention_days',7),
('free','quota.alert_rules',5),
('free','quota.notification_channels',2),
('free','quota.daily_alerts',0),
('free','quota.monthly_alerts',0),
('free','quota.connector_sends',0),
('free','quota.status_pages',0),
('free','quota.integrations',2),
('free','quota.api_tokens',2),
('free','quota.webhooks',2),
('free','quota.service_accounts',0),
('free','quota.custom_roles',0),
('free','quota.audit_log_retention_days',0),
('free','quota.ai_requests',0),

-- ================= STARTER =================
('starter','quota.retention_days',30),
('starter','quota.log_retention_days',30),
('starter','quota.metric_retention_days',30),
('starter','quota.profile_retention_days',30),
('starter','quota.replay_retention_days',7),
('starter','quota.trace_retention_days',30),
('starter','quota.notification_channels',10),
('starter','quota.daily_alerts',100),
('starter','quota.monthly_alerts',1000),
('starter','quota.connector_sends',1000),
('starter','quota.status_pages',1),
('starter','quota.integrations',10),
('starter','quota.api_tokens',10),
('starter','quota.webhooks',10),
('starter','quota.service_accounts',2),
('starter','quota.custom_roles',0),
('starter','quota.audit_log_retention_days',30),
('starter','quota.ai_requests',1000),

-- ================= GROWTH =================
('growth','quota.retention_days',90),
('growth','quota.log_retention_days',90),
('growth','quota.metric_retention_days',90),
('growth','quota.profile_retention_days',90),
('growth','quota.replay_retention_days',30),
('growth','quota.trace_retention_days',90),
('growth','quota.notification_channels',50),
('growth','quota.daily_alerts',1000),
('growth','quota.monthly_alerts',25000),
('growth','quota.connector_sends',25000),
('growth','quota.status_pages',5),
('growth','quota.integrations',50),
('growth','quota.api_tokens',50),
('growth','quota.webhooks',50),
('growth','quota.service_accounts',10),
('growth','quota.custom_roles',25),
('growth','quota.audit_log_retention_days',180),
('growth','quota.ai_requests',10000),

-- ================= BUSINESS =================
('business','quota.retention_days',180),
('business','quota.log_retention_days',180),
('business','quota.metric_retention_days',180),
('business','quota.profile_retention_days',180),
('business','quota.replay_retention_days',90),
('business','quota.trace_retention_days',180),
('business','quota.notification_channels',250),
('business','quota.daily_alerts',10000),
('business','quota.monthly_alerts',250000),
('business','quota.connector_sends',250000),
('business','quota.status_pages',25),
('business','quota.integrations',250),
('business','quota.api_tokens',250),
('business','quota.webhooks',250),
('business','quota.service_accounts',100),
('business','quota.custom_roles',100),
('business','quota.audit_log_retention_days',365),
('business','quota.ai_requests',100000),

-- ================= ENTERPRISE =================
('enterprise','quota.retention_days',365),
('enterprise','quota.log_retention_days',365),
('enterprise','quota.metric_retention_days',365),
('enterprise','quota.profile_retention_days',365),
('enterprise','quota.replay_retention_days',365),
('enterprise','quota.trace_retention_days',365),
('enterprise','quota.notification_channels',1000),
('enterprise','quota.daily_alerts',100000),
('enterprise','quota.monthly_alerts',1000000),
('enterprise','quota.connector_sends',1000000),
('enterprise','quota.status_pages',100),
('enterprise','quota.integrations',1000),
('enterprise','quota.api_tokens',1000),
('enterprise','quota.webhooks',1000),
('enterprise','quota.service_accounts',1000),
('enterprise','quota.custom_roles',1000),
('enterprise','quota.audit_log_retention_days',2555),
('enterprise','quota.ai_requests',1000000)
)

INSERT INTO plan_feature_entitlements
(plan_id, feature_id, integer_value)
SELECT
    p.id,
    f.id,
    q.integer_value
FROM quota_seed q
JOIN plans p ON p.key=q.plan_key
JOIN billing_features f ON f.feature_key=q.feature_key
ON CONFLICT (plan_id, feature_id)
DO UPDATE SET
    integer_value=EXCLUDED.integer_value,
    updated_at=NOW(),
    deleted_at=NULL;

COMMIT;
