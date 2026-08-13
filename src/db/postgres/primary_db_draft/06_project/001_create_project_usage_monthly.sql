-- Normalized final definition for project_usage_monthly.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_usage_monthly (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  year_month VARCHAR(7) NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  api_key_requests BIGINT NOT NULL DEFAULT 0,
  rate_limited_events BIGINT NOT NULL DEFAULT 0,
  alert_notifications BIGINT NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  UNIQUE (project_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_monthly_org
  ON project_usage_monthly(organization_id, year_month);
