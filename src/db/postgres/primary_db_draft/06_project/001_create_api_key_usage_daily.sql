-- Physical retained fact for billing and long-range API-key usage.

CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id),
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type_id)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_project
  ON api_key_usage_daily(project_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_org
  ON api_key_usage_daily(organization_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_daily_env
  ON api_key_usage_daily(environment_id, bucket DESC)
  WHERE environment_id IS NOT NULL;
