-- =============================================================================
-- Module      : Billing
-- Migration   : 005_plan_feature_entitlements.sql
-- Description : Maps billing plans to feature entitlements
-- PostgreSQL  : 16+
-- Depends On  : 002_plans.sql
--               004_billing_features.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS plan_feature_entitlements
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL
        REFERENCES plans(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_plan_feature UNIQUE(plan_id, feature_id),

    CONSTRAINT chk_single_value CHECK (
        ((boolean_value IS NOT NULL)::int +
         (integer_value IS NOT NULL)::int +
         (decimal_value IS NOT NULL)::int +
         (string_value IS NOT NULL)::int) <= 1
    )
);

COMMENT ON TABLE plan_feature_entitlements IS
'Resolved feature values for each billing plan. Every feature is represented by one row instead of JSON configuration.';

CREATE INDEX IF NOT EXISTS idx_pfe_plan
ON plan_feature_entitlements(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_feature
ON plan_feature_entitlements(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pfe_plan_feature
ON plan_feature_entitlements(plan_id, feature_id)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_plan_feature_entitlements_updated_at
ON plan_feature_entitlements;

CREATE TRIGGER trg_plan_feature_entitlements_updated_at
BEFORE UPDATE
ON plan_feature_entitlements
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Seed entitlements for FREE plan
-- Assumes plan.key='free' exists from seed migration or earlier insert.
-- ============================================================================

WITH free_plan AS (
    SELECT id FROM plans WHERE key='free' AND is_active = TRUE LIMIT 1
),
vals(feature_key, bool_val, int_val) AS (
VALUES
('monthly_events',NULL,5000),
('projects',NULL,1),
('organization_members',NULL,3),
('api_keys',NULL,1),
('connectors',NULL,0),
('alert_rules',NULL,0),
('dashboards',NULL,0),
('retention_days',NULL,7),
('ai_credits',NULL,50),

('request_capture',TRUE,NULL),
('error_tracking',TRUE,NULL),
('distributed_tracing',FALSE,NULL),
('performance_monitoring',FALSE,NULL),
('metrics',FALSE,NULL),
('logs',FALSE,NULL),
('session_replay',FALSE,NULL),
('cpu_profiling',FALSE,NULL),
('cron_monitoring',FALSE,NULL),

('in_app_alerts',TRUE,NULL),
('email_alerts',FALSE,NULL),
('slack_connector',FALSE,NULL),
('discord_connector',FALSE,NULL),
('teams_connector',FALSE,NULL),
('webhook_connector',FALSE,NULL),

('ai_chat',FALSE,NULL),
('ai_error_explanation',FALSE,NULL),
('ai_root_cause',FALSE,NULL),
('ai_trace_analysis',FALSE,NULL),
('ai_log_summary',FALSE,NULL),

('custom_dashboards',FALSE,NULL),
('saved_views',FALSE,NULL),

('sso',FALSE,NULL),
('scim',FALSE,NULL),
('audit_logs',FALSE,NULL),
('ip_allowlist',FALSE,NULL)
)
INSERT INTO plan_feature_entitlements
(
 plan_id,
 feature_id,
 boolean_value,
 integer_value
)
SELECT
 fp.id,
 bf.id,
 vals.bool_val,
 vals.int_val
FROM vals
JOIN billing_features bf
  ON bf.feature_key = vals.feature_key
CROSS JOIN free_plan fp
ON CONFLICT (plan_id, feature_id) DO NOTHING;

COMMIT;
