BEGIN;

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

DROP TRIGGER IF EXISTS trg_alerting_dashboard_widgets_updated_at ON alerting_dashboard_widgets;
CREATE TRIGGER trg_alerting_dashboard_widgets_updated_at
  BEFORE UPDATE ON alerting_dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_alerting_saved_views_updated_at ON alerting_saved_views;
CREATE TRIGGER trg_alerting_saved_views_updated_at
  BEFORE UPDATE ON alerting_saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
