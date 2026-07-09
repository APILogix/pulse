-- =============================================================================
-- Module      : Billing
-- Migration   : 004_billing_features.sql
-- Description : Feature catalog for billing entitlements
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               002_plans.sql
--               003_plan_prices.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS billing_features
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_key        VARCHAR(100) NOT NULL,
    feature_name       VARCHAR(150) NOT NULL,
    description        TEXT,

    category           billing_feature_category NOT NULL,
    value_type         billing_feature_value_type NOT NULL,

    is_billable        BOOLEAN NOT NULL DEFAULT TRUE,
    is_public          BOOLEAN NOT NULL DEFAULT TRUE,
    is_deprecated      BOOLEAN NOT NULL DEFAULT FALSE,

    sort_order         INTEGER NOT NULL DEFAULT 0,

    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ,

    CONSTRAINT uq_billing_feature_key UNIQUE(feature_key)
);

COMMENT ON TABLE billing_features IS
'Master catalog of all billable platform features and limits. Plans reference these features through entitlement records.';

CREATE INDEX IF NOT EXISTS idx_billing_features_category
ON billing_features(category)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_public
ON billing_features(is_public, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_features_billable
ON billing_features(is_billable)
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_billing_features_updated_at
ON billing_features;

CREATE TRIGGER trg_billing_features_updated_at
BEFORE UPDATE
ON billing_features
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO billing_features
(feature_key,feature_name,category,value_type,sort_order)
VALUES
('monthly_events','Monthly Events','limits','integer',1),
('projects','Projects','limits','integer',2),
('organization_members','Organization Members','limits','integer',3),
('api_keys','API Keys','limits','integer',4),
('connectors','Connectors','limits','integer',5),
('alert_rules','Alert Rules','limits','integer',6),
('dashboards','Dashboards','limits','integer',7),
('retention_days','Retention Days','limits','integer',8),
('ai_credits','AI Credits','limits','integer',9),

('request_capture','Request Capture','monitoring','boolean',100),
('error_tracking','Error Tracking','monitoring','boolean',101),
('distributed_tracing','Distributed Tracing','monitoring','boolean',102),
('performance_monitoring','Performance Monitoring','monitoring','boolean',103),
('metrics','Metrics','monitoring','boolean',104),
('logs','Logs','monitoring','boolean',105),
('session_replay','Session Replay','monitoring','boolean',106),
('cpu_profiling','CPU Profiling','monitoring','boolean',107),
('cron_monitoring','Cron Monitoring','monitoring','boolean',108),

('in_app_alerts','In App Alerts','alerts','boolean',200),
('email_alerts','Email Alerts','alerts','boolean',201),
('slack_connector','Slack Connector','integrations','boolean',202),
('discord_connector','Discord Connector','integrations','boolean',203),
('teams_connector','Teams Connector','integrations','boolean',204),
('webhook_connector','Webhook Connector','integrations','boolean',205),

('ai_chat','AI Chat','ai','boolean',300),
('ai_error_explanation','AI Error Explanation','ai','boolean',301),
('ai_root_cause','AI Root Cause Analysis','ai','boolean',302),
('ai_trace_analysis','AI Trace Analysis','ai','boolean',303),
('ai_log_summary','AI Log Summary','ai','boolean',304),

('custom_dashboards','Custom Dashboards','dashboard','boolean',400),
('saved_views','Saved Views','dashboard','boolean',401),

('sso','Single Sign-On','security','boolean',500),
('scim','SCIM Provisioning','security','boolean',501),
('audit_logs','Audit Logs','security','boolean',502),
('ip_allowlist','IP Allowlist','security','boolean',503)

ON CONFLICT (feature_key) DO NOTHING;

COMMIT;
