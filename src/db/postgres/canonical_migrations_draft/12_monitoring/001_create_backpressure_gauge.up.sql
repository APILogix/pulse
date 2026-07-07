BEGIN;

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pending_depth BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_worker_id TEXT
);

INSERT INTO backpressure_gauge (id, pending_depth, updated_at, last_worker_id)
VALUES (1, 0, NOW(), 'init')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_backpressure_gauge_updated
  ON backpressure_gauge(updated_at);

COMMENT ON TABLE backpressure_gauge IS
  'Shared cross-process queue depth gauge. Workers UPDATE after batches. API servers READ for health checks.';

COMMIT;
