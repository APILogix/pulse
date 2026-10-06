-- Normalized final definition for alerting_dashboard_widgets.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  widget_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  position JSONB NOT NULL DEFAULT '{}'::jsonb,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_dashboard_widget UNIQUE (workspace_id, widget_key),
  CONSTRAINT ck_alerting_dashboard_position CHECK (jsonb_typeof(position) = 'object'),
  CONSTRAINT ck_alerting_dashboard_configuration CHECK (jsonb_typeof(configuration) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_dashboard_widgets_workspace_position
  ON alerting_dashboard_widgets(workspace_id, is_visible, widget_key);
