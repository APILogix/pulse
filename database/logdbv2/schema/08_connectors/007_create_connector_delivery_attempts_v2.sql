-- Detailed connector transmission attempt history (range-partitioned by attempted_at)
CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID NOT NULL,
  delivery_created_at   TIMESTAMPTZ NOT NULL,
  attempt_number        INTEGER NOT NULL,
  status                connector_delivery_status_v2 NOT NULL,
  response_status_code  INTEGER,
  error_category        VARCHAR(64),
  error_message         TEXT,
  response              JSONB,
  duration_ms           INTEGER,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2_default PARTITION OF connector_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_delivery_attempts_v2_idem
  ON connector_delivery_attempts_v2 (delivery_id, attempt_number, attempted_at);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_connector
  ON connector_delivery_attempts_v2 (connector_id, status, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_delivery
  ON connector_delivery_attempts_v2 (delivery_id, attempted_at DESC);

