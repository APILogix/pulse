-- Normalized final definition for backpressure_gauge.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_depth BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_worker_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_backpressure_gauge_updated
  ON backpressure_gauge(updated_at);
