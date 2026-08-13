-- Normalized final definition for connector_test_runs.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES users(id),
  status VARCHAR(30) NOT NULL,
  response JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_connector
ON connector_test_runs (connector_id);

CREATE INDEX IF NOT EXISTS idx_test_created
ON connector_test_runs (created_at DESC);
