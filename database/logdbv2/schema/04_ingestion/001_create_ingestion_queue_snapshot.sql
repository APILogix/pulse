-- Ingestion queue depth and snapshot statistics (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pending_count BIGINT NOT NULL DEFAULT 0,
  active_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  oldest_pending_at TIMESTAMPTZ,
  worker_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot_default PARTITION OF ingestion_queue_snapshot DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_queue_time ON ingestion_queue_snapshot(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_brin ON ingestion_queue_snapshot USING BRIN (captured_at);
