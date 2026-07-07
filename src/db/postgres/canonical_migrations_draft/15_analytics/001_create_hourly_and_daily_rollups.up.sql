BEGIN;

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_hour TIMESTAMPTZ NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_hourly_rollup_unique UNIQUE (organization_id, project_id, bucket_hour)
);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket_date DATE NOT NULL,
  error_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  span_count INTEGER DEFAULT 0,
  trace_count INTEGER DEFAULT 0,
  metric_count INTEGER DEFAULT 0,
  log_count INTEGER DEFAULT 0,
  profile_count INTEGER DEFAULT 0,
  cron_checkin_count INTEGER DEFAULT 0,
  replay_count INTEGER DEFAULT 0,
  error_fatal_count INTEGER DEFAULT 0,
  error_error_count INTEGER DEFAULT 0,
  error_warning_count INTEGER DEFAULT 0,
  error_info_count INTEGER DEFAULT 0,
  error_debug_count INTEGER DEFAULT 0,
  request_2xx_count INTEGER DEFAULT 0,
  request_3xx_count INTEGER DEFAULT 0,
  request_4xx_count INTEGER DEFAULT 0,
  request_5xx_count INTEGER DEFAULT 0,
  request_avg_latency_ms INTEGER,
  request_p95_latency_ms INTEGER,
  request_p99_latency_ms INTEGER,
  unique_user_count INTEGER DEFAULT 0,
  active_services TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_daily_rollup_unique UNIQUE (organization_id, project_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_hourly_rollup_org_hour
  ON analytics_hourly_rollup(organization_id, project_id, bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rollup_org_date
  ON analytics_daily_rollup(organization_id, project_id, bucket_date DESC);

DROP TRIGGER IF EXISTS trg_hourly_rollup_updated_at ON analytics_hourly_rollup;
CREATE TRIGGER trg_hourly_rollup_updated_at
  BEFORE UPDATE ON analytics_hourly_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_daily_rollup_updated_at ON analytics_daily_rollup;
CREATE TRIGGER trg_daily_rollup_updated_at
  BEFORE UPDATE ON analytics_daily_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
