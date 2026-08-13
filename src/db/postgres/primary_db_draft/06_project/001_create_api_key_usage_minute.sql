-- Normalized final definition for api_key_usage_minute.
-- Canonical/historical sources include:
-- - migrations/003_project_module_refactor.sql

CREATE TABLE IF NOT EXISTS api_key_usage_minute (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(50) NOT NULL DEFAULT '__all__',
  requests BIGINT NOT NULL DEFAULT 0,
  events BIGINT NOT NULL DEFAULT 0,
  errors BIGINT NOT NULL DEFAULT 0,
  latency_ms_p50 NUMERIC,
  latency_ms_p95 NUMERIC,
  latency_ms_p99 NUMERIC,
  rate_limited BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_project
  ON api_key_usage_minute(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_minute_env
  ON api_key_usage_minute(environment_id, bucket DESC)
  WHERE environment_id IS NOT NULL;
