-- Normalized final definition for project_usage_minute.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS project_usage_minute (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  total_events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  transactions BIGINT NOT NULL DEFAULT 0,
  traces BIGINT NOT NULL DEFAULT 0,
  spans BIGINT NOT NULL DEFAULT 0,
  logs BIGINT NOT NULL DEFAULT 0,
  metrics BIGINT NOT NULL DEFAULT 0,
  profiles BIGINT NOT NULL DEFAULT 0,
  ai_events BIGINT NOT NULL DEFAULT 0,
  sdk_requests BIGINT NOT NULL DEFAULT 0,
  active_api_keys INTEGER NOT NULL DEFAULT 0,
  active_environments INTEGER NOT NULL DEFAULT 0,
  active_users BIGINT NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  connector_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_notifications INTEGER NOT NULL DEFAULT 0,
  top_endpoints JSONB NOT NULL DEFAULT '{}',
  top_services JSONB NOT NULL DEFAULT '{}',
  top_error_groups JSONB NOT NULL DEFAULT '{}',
  top_sdk_versions JSONB NOT NULL DEFAULT '{}',
  top_countries JSONB NOT NULL DEFAULT '{}',
  top_browsers JSONB NOT NULL DEFAULT '{}',
  top_os JSONB NOT NULL DEFAULT '{}',
  top_devices JSONB NOT NULL DEFAULT '{}',
  top_releases JSONB NOT NULL DEFAULT '{}',
  rate_limit_usage BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  PRIMARY KEY (project_id, bucket)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_minute_project_bucket
  ON project_usage_minute(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_project_usage_minute_org_bucket
  ON project_usage_minute(organization_id, bucket DESC);
