-- Normalized final definition for connector_delivery_attempts.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_delivery_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL,
  delivery_created_at TIMESTAMPTZ NOT NULL,
  attempt_number INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  error_code VARCHAR(100),
  error_message TEXT,
  response JSONB,
  duration_ms INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, attempted_at),
  FOREIGN KEY (delivery_id, delivery_created_at)
  REFERENCES connector_deliveries(id, created_at) ON DELETE CASCADE
) PARTITION BY RANGE (attempted_at);

CREATE INDEX IF NOT EXISTS idx_attempt_delivery
ON connector_delivery_attempts (delivery_id);

CREATE INDEX IF NOT EXISTS idx_attempt_status
ON connector_delivery_attempts (status);

CREATE INDEX IF NOT EXISTS idx_attempt_time
ON connector_delivery_attempts (attempted_at DESC);
