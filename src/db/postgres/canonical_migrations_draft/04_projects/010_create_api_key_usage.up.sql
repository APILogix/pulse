BEGIN;

CREATE TABLE IF NOT EXISTS api_key_usage_minute (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  bucket TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(100) NOT NULL DEFAULT 'all',
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  total_events BIGINT NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  errors BIGINT NOT NULL DEFAULT 0 CHECK (errors >= 0),
  bytes_ingested BIGINT NOT NULL DEFAULT 0 CHECK (bytes_ingested >= 0),
  rate_limited BIGINT NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  latency_ms_p50 NUMERIC(12,3), latency_ms_p95 NUMERIC(12,3), latency_ms_p99 NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id, bucket, event_type)
);
CREATE TABLE IF NOT EXISTS api_key_usage_hourly (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  bucket TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(100) NOT NULL DEFAULT 'all',
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  total_events BIGINT NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  errors BIGINT NOT NULL DEFAULT 0 CHECK (errors >= 0),
  bytes_ingested BIGINT NOT NULL DEFAULT 0 CHECK (bytes_ingested >= 0),
  rate_limited BIGINT NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  latency_ms_p50 NUMERIC(12,3), latency_ms_p95 NUMERIC(12,3), latency_ms_p99 NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id, bucket, event_type)
);
CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  bucket DATE NOT NULL,
  event_type VARCHAR(100) NOT NULL DEFAULT 'all',
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  total_events BIGINT NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  errors BIGINT NOT NULL DEFAULT 0 CHECK (errors >= 0),
  bytes_ingested BIGINT NOT NULL DEFAULT 0 CHECK (bytes_ingested >= 0),
  rate_limited BIGINT NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  latency_ms_p50 NUMERIC(12,3), latency_ms_p95 NUMERIC(12,3), latency_ms_p99 NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id, bucket, event_type)
);
CREATE TABLE IF NOT EXISTS api_key_usage_monthly (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE CASCADE,
  bucket DATE NOT NULL CHECK (bucket=date_trunc('month',bucket)::date),
  event_type VARCHAR(100) NOT NULL DEFAULT 'all',
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  total_events BIGINT NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  errors BIGINT NOT NULL DEFAULT 0 CHECK (errors >= 0),
  bytes_ingested BIGINT NOT NULL DEFAULT 0 CHECK (bytes_ingested >= 0),
  rate_limited BIGINT NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  latency_ms_p50 NUMERIC(12,3), latency_ms_p95 NUMERIC(12,3), latency_ms_p99 NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id, bucket, event_type)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_minute_project_bucket ON api_key_usage_minute(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_minute_environment_bucket ON api_key_usage_minute(environment_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_minute_org_bucket ON api_key_usage_minute(organization_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_hourly_project_bucket ON api_key_usage_hourly(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_hourly_environment_bucket ON api_key_usage_hourly(environment_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_hourly_org_bucket ON api_key_usage_hourly(organization_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_project_bucket ON api_key_usage_daily(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_environment_bucket ON api_key_usage_daily(environment_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_org_bucket ON api_key_usage_daily(organization_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_monthly_project_bucket ON api_key_usage_monthly(project_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_monthly_environment_bucket ON api_key_usage_monthly(environment_id, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_monthly_org_bucket ON api_key_usage_monthly(organization_id, bucket DESC);
COMMENT ON TABLE api_key_usage_minute IS 'Canonical per-key minute usage; tenant dimensions are denormalized and integrity-checked by trigger.';
COMMENT ON TABLE api_key_usage_hourly IS 'Canonical per-key hourly usage for API-key comparisons and rate-limit dashboards.';
COMMENT ON TABLE api_key_usage_daily IS 'Canonical per-key daily usage for retention and historical dashboards.';
COMMENT ON TABLE api_key_usage_monthly IS 'Canonical per-key monthly usage for billing and long-range API-key comparisons.';
COMMENT ON COLUMN api_key_usage_minute.bucket IS 'UTC minute bucket.';
COMMENT ON COLUMN api_key_usage_hourly.bucket IS 'UTC hour bucket.';
COMMENT ON COLUMN api_key_usage_daily.bucket IS 'UTC calendar-day bucket.';
COMMENT ON COLUMN api_key_usage_monthly.bucket IS 'UTC first day of the calendar-month bucket.';
COMMIT;
