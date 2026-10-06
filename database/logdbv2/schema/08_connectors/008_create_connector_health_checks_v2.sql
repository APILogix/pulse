-- Dedicated connector health probe execution log (range-partitioned by checked_at)
CREATE TABLE IF NOT EXISTS connector_health_checks_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  health_state          VARCHAR(64) NOT NULL,
  response_time_ms      INTEGER,
  error_message         TEXT,
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_v2_default PARTITION OF connector_health_checks_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_connector
  ON connector_health_checks_v2 (connector_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_unhealthy
  ON connector_health_checks_v2 (organization_id, checked_at DESC)
  WHERE health_state <> 'healthy';

