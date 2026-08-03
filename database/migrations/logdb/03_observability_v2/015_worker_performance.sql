BEGIN;

-- Worker performance telemetry.
-- Captures throughput, latency percentiles, and resource usage per worker.
CREATE TABLE IF NOT EXISTS worker_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  memory_mb NUMERIC(12,3),
  cpu_percent NUMERIC(6,3),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS worker_performance_default PARTITION OF worker_performance DEFAULT;

CREATE INDEX IF NOT EXISTS idx_worker_performance_worker_time
  ON worker_performance (worker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_performance_brin
  ON worker_performance USING BRIN (captured_at);

COMMIT;
