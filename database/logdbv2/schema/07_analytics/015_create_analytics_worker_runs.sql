-- Analytics aggregation engine worker execution ledger (range-partitioned by started_at)
CREATE TABLE IF NOT EXISTS analytics_worker_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  organization_id UUID,
  window_size     TEXT NOT NULL,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_written    BIGINT NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

CREATE TABLE IF NOT EXISTS analytics_worker_runs_default PARTITION OF analytics_worker_runs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_worker_time
  ON analytics_worker_runs (worker_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_failures
  ON analytics_worker_runs (worker_id, started_at DESC)
  WHERE outcome <> 'success';

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_brin
  ON analytics_worker_runs USING BRIN (started_at);

