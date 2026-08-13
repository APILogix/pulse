-- Normalized final definition for alerting_maintenance_config.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql

CREATE TABLE IF NOT EXISTS alerting_maintenance_config (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  suppression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  recurring_support_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_suppression_settings JSONB NOT NULL DEFAULT '{"suppressNotifications":true,"suppressEvaluation":false}'::jsonb,
  calendar_metadata JSONB NOT NULL DEFAULT '{"windows":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_maintenance_suppression CHECK (jsonb_typeof(default_suppression_settings) = 'object'),
  CONSTRAINT ck_alerting_maintenance_calendar CHECK (jsonb_typeof(calendar_metadata) = 'object')
);
