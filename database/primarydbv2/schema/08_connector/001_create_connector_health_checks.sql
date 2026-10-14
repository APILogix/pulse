-- Normalized final definition for connector_health_checks.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_health_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  http_status INTEGER,
  dns_time_ms INTEGER,
  tls_time_ms INTEGER,
  connect_time_ms INTEGER,
  response_time_ms INTEGER,
  error_code VARCHAR(100),
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE INDEX IF NOT EXISTS idx_health_connector_recent
ON connector_health_checks (connector_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_status
ON connector_health_checks (status);

CREATE INDEX IF NOT EXISTS idx_health_checked_at
ON connector_health_checks (checked_at DESC);
