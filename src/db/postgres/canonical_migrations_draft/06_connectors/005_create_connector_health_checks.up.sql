BEGIN;

CREATE TABLE IF NOT EXISTS connector_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_connector
  ON connector_health_checks(connector_id, checked_at DESC);

COMMIT;
