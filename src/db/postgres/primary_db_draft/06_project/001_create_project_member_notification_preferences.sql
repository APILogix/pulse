-- Normalized final definition for project_member_notification_preferences.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_member_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  category alert_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  quiet_hours JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id, channel, category)
);

CREATE INDEX IF NOT EXISTS idx_project_member_notif_prefs_user
  ON project_member_notification_preferences(project_id, user_id);
