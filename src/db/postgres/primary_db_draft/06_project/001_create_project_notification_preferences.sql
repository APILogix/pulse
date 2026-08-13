-- Normalized final definition for project_notification_preferences.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category alert_category NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_threshold severity_threshold NOT NULL DEFAULT 'error',
  connector_ids UUID[] NOT NULL DEFAULT '{}',
  member_ids UUID[] NOT NULL DEFAULT '{}',
  quiet_hours JSONB,
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
  escalation_policy_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  default_channel_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  default_member_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  role_targets project_member_role[] NOT NULL DEFAULT ARRAY['owner','admin']::project_member_role[],
  escalation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (project_id, category)
);

CREATE INDEX IF NOT EXISTS idx_project_notification_preferences_enabled
  ON project_notification_preferences(organization_id,project_id,enabled) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_notif_prefs_project
  ON project_notification_preferences(project_id);
