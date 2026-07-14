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
-- FREE
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'free'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 5000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 3::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 0::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 1::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 7::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 0::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- STARTER
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'starter'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 100000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 10::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 10::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 5::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 30::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 1000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- GROWTH
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'growth'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 1000000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 50::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 25::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 90::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 10000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- BUSINESS
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'business'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, 5000000::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, 250::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, 500::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, 100::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, 180::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, 50000::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', FALSE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ============================================================================
-- ENTERPRISE
-- ============================================================================

WITH plan AS (
    SELECT id
    FROM plans
    WHERE key = 'enterprise'
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1
),
vals(feature_key, boolean_value, integer_value, decimal_value, string_value) AS (
VALUES
    ('monthly_events', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('projects', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('organization_members', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('api_keys', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('connectors', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('alert_rules', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('dashboards', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('retention_days', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('ai_credits', NULL::boolean, -1::bigint, NULL::numeric, NULL::text),
    ('request_capture', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('error_tracking', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('distributed_tracing', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('performance_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('metrics', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('session_replay', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cpu_profiling', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('cron_monitoring', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('in_app_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('email_alerts', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('slack_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('discord_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('teams_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('webhook_connector', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_chat', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_error_explanation', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_root_cause', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_trace_analysis', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ai_log_summary', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('custom_dashboards', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('saved_views', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('sso', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('scim', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('audit_logs', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text),
    ('ip_allowlist', TRUE::boolean, NULL::bigint, NULL::numeric, NULL::text)
)
INSERT INTO plan_feature_entitlements
    (plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value)
SELECT
    plan.id,
    billing_features.id,
    vals.boolean_value,
    vals.integer_value,
    vals.decimal_value,
    vals.string_value
FROM plan
JOIN vals ON TRUE
JOIN billing_features
  ON billing_features.feature_key = vals.feature_key
 AND billing_features.deleted_at IS NULL
ON CONFLICT (plan_id, feature_id) DO NOTHING;

COMMIT;
