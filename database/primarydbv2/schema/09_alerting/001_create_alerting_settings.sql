-- Normalized final definition for alerting_settings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_settings (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  default_evaluation_window_seconds INTEGER NOT NULL DEFAULT 300 CHECK (default_evaluation_window_seconds > 0),
  default_cooldown_seconds INTEGER NOT NULL DEFAULT 900 CHECK (default_cooldown_seconds >= 0),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  default_severity alert_severity NOT NULL DEFAULT 'warning',
  default_routing_key VARCHAR(100) NOT NULL DEFAULT 'severity_default',
  default_escalation_policy_id UUID REFERENCES alerting_escalation_policies_v2(id) ON DELETE SET NULL,
  maximum_incident_age_seconds INTEGER NOT NULL DEFAULT 604800 CHECK (maximum_incident_age_seconds > 0),
  digest_defaults JSONB NOT NULL DEFAULT '{"enabled":true,"frequency":"daily"}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_settings_digest_defaults CHECK (jsonb_typeof(digest_defaults) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_settings_escalation
  ON alerting_settings(default_escalation_policy_id)
  WHERE default_escalation_policy_id IS NOT NULL;
