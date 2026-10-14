-- Normalized final definition for project_alert_thresholds.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql

CREATE TABLE IF NOT EXISTS project_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE CASCADE,
  threshold_key VARCHAR(100) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  metric_source VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  comparison_operator VARCHAR(10) NOT NULL CHECK(comparison_operator IN ('>','>=','<','<=','=','!=')),
  threshold_value NUMERIC(20,5) NOT NULL,
  threshold_unit VARCHAR(50) NOT NULL,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK(evaluation_window_minutes>0),
  cooldown_minutes INTEGER NOT NULL DEFAULT 15 CHECK(cooldown_minutes>=0),
  consecutive_breaches INTEGER NOT NULL DEFAULT 1 CHECK(consecutive_breaches>0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_on_recovery BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  last_recovered_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_threshold_key ON project_alert_thresholds(project_id,environment_id,threshold_key) NULLS NOT DISTINCT WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_thresholds_evaluation ON project_alert_thresholds(organization_id,project_id,environment_id,enabled) WHERE deleted_at IS NULL;
