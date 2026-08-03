BEGIN;

-- Backpressure gauge.
-- Score + reason for ingestion backpressure events.
CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pressure_score NUMERIC(8,4) NOT NULL CHECK (pressure_score >= 0),
  reason TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS backpressure_gauge_default PARTITION OF backpressure_gauge DEFAULT;

CREATE INDEX IF NOT EXISTS idx_backpressure_queue_time
  ON backpressure_gauge (queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_backpressure_brin
  ON backpressure_gauge USING BRIN (captured_at);

COMMIT;
