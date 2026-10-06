-- User-initiated connector test execution facts (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_test_runs_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  triggered_by          UUID,
  status                VARCHAR(32) NOT NULL,
  response              JSONB,
  error_message         TEXT,
  duration_ms           INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_test_runs_v2_default PARTITION OF connector_test_runs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_test_runs_v2_connector
  ON connector_test_runs_v2 (connector_id, created_at DESC);

