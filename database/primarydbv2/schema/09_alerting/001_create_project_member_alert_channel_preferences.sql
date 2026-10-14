-- Normalized final definition for project_member_alert_channel_preferences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql

CREATE TABLE IF NOT EXISTS project_member_alert_channel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL DEFAULT 'all',
  severity_threshold VARCHAR(20) NOT NULL DEFAULT 'warning',
  enabled BOOLEAN NOT NULL DEFAULT true,
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id,user_id,project_alert_channel_id,category)
);

CREATE INDEX IF NOT EXISTS idx_member_alert_preferences_delivery
  ON project_member_alert_channel_preferences(project_id,user_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_alert_prefs_lookup
  ON project_member_alert_channel_preferences (organization_id, project_id, user_id, project_alert_channel_id)
  WHERE deleted_at IS NULL;

