-- =============================================================================
-- Module      : Billing
-- Migration   : 028a_seed_billing_features_core.sql
-- Description : Seed core billing feature catalog (Quotas)
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

WITH feature_seed (
    feature_key,
    name,
    description,
    category,
    module,
    value_type,
    usage_behavior,
    configuration,
    is_public,
    is_module_root
) AS (
VALUES

('quota.monthly_events','Monthly Events',
 'Maximum billable events per billing cycle',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.monthly_spans','Monthly Spans',
 'Maximum billable spans per billing cycle',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.monthly_logs','Monthly Logs',
 'Maximum billable log events per billing cycle',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.monthly_metrics','Monthly Metrics',
 'Maximum metric points per billing cycle',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.monthly_profiles','Monthly Profiles',
 'Maximum profiling captures per billing cycle',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.monthly_replays','Monthly Session Replays',
 'Maximum session replay recordings',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.projects','Projects',
 'Maximum projects allowed',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.environments','Environments',
 'Maximum deployment environments',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.api_keys','API Keys',
 'Maximum API keys',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.members','Members',
 'Maximum organization members',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.retention_days','Retention Days',
 'Maximum data retention period',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.requests_per_second','Requests Per Second',
 'Maximum ingestion throughput',
 'quota','quota','integer','throttle','{}'::jsonb,TRUE,FALSE),

('quota.ai_credits','AI Credits',
 'Monthly AI credit allocation',
 'quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('quota.alert_rules','Alert Rules',
 'Maximum alert rules',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('quota.dashboards','Dashboards',
 'Maximum dashboards',
 'quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE)

)

INSERT INTO billing_features
(
    feature_key,
    feature_name,
    description,
    category,
    module,
    value_type,
    usage_behavior,
    configuration,
    is_public,
    is_module_root
)
SELECT
    feature_key,
    name,
    description,
    category::billing_feature_category,
    module,
    value_type::billing_feature_value_type,
    usage_behavior::billing_usage_behavior,
    configuration,
    is_public,
    is_module_root
FROM feature_seed

ON CONFLICT (feature_key)
DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    module = EXCLUDED.module,
    value_type = EXCLUDED.value_type,
    usage_behavior = EXCLUDED.usage_behavior,
    configuration = EXCLUDED.configuration,
    is_public = EXCLUDED.is_public,
    is_module_root = EXCLUDED.is_module_root,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;
