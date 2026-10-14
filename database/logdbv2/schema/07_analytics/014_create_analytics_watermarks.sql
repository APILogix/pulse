-- Aggregation progress watermarks for analytics worker processes
CREATE TABLE IF NOT EXISTS analytics_watermarks (
  worker_id            TEXT NOT NULL,
  organization_id      UUID NOT NULL,
  window_size          TEXT NOT NULL,
  watermark_at         TIMESTAMPTZ NOT NULL,
  last_bucket_at       TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed       BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, organization_id, window_size)
);

CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_worker_lag
  ON analytics_watermarks (worker_id, watermark_at);

CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_failing
  ON analytics_watermarks (worker_id, consecutive_failures)
  WHERE consecutive_failures > 0;

