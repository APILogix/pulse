-- Normalized final definition for alerting_notification_defaults.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql

CREATE TABLE IF NOT EXISTS alerting_notification_defaults (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  digest_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  business_hours JSONB NOT NULL DEFAULT '{"enabled":true,"start":"09:00","end":"17:00","days":[1,2,3,4,5]}'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{"enabled":false,"start":"22:00","end":"07:00"}'::jsonb,
  fallback_behavior VARCHAR(30) NOT NULL DEFAULT 'dashboard'
  CHECK (fallback_behavior IN ('dashboard', 'email', 'drop')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_notification_business_hours CHECK (jsonb_typeof(business_hours) = 'object'),
  CONSTRAINT ck_alerting_notification_quiet_hours CHECK (jsonb_typeof(quiet_hours) = 'object')
);
