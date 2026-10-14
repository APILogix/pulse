-- Typed connector deliveries v2 runtime (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_deliveries_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  connector_id          UUID NOT NULL,
  route_id              UUID,
  notification_job_id   UUID,
  alert_event_id        UUID,
  channel_kind          notification_channel_kind,
  notification_type     VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity              logdb_severity NOT NULL DEFAULT 'info',
  status                connector_delivery_status_v2 NOT NULL DEFAULT 'pending',
  correlation_id        UUID NOT NULL,
  idempotency_key       VARCHAR(255),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes    INTEGER,
  response_status_code  INTEGER,
  response_body         TEXT,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  error_details         JSONB,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 3,
  first_attempt_at      TIMESTAMPTZ,
  last_attempt_at       TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  next_retry_at         TIMESTAMPTZ,
  duration_ms           INTEGER,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_v2_default PARTITION OF connector_deliveries_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_idem
  ON connector_deliveries_v2 (organization_id, idempotency_key, created_at)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_connector
  ON connector_deliveries_v2 (connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_retry
  ON connector_deliveries_v2 (status, next_retry_at)
  WHERE status = 'retrying' AND next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_job
  ON connector_deliveries_v2 (notification_job_id, created_at DESC)
  WHERE notification_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_correlation
  ON connector_deliveries_v2 (correlation_id);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_channel
  ON connector_deliveries_v2 (organization_id, channel_kind, created_at DESC)
  WHERE channel_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_org_time
  ON connector_deliveries_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_created_brin
  ON connector_deliveries_v2 USING BRIN (created_at);
