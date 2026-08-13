-- Normalized final definition for analytics_daily_rollup.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

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

CREATE INDEX IF NOT EXISTS idx_daily_rollup_org_date
  ON analytics_daily_rollup(organization_id, project_id, bucket_date DESC);
