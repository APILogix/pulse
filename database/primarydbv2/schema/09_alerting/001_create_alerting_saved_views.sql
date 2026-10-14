-- Normalized final definition for alerting_saved_views.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  view_key VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_saved_view UNIQUE (workspace_id, view_key),
  CONSTRAINT ck_alerting_saved_view_filters CHECK (jsonb_typeof(filters) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_saved_views_workspace_system
  ON alerting_saved_views(workspace_id, is_system, view_key);
