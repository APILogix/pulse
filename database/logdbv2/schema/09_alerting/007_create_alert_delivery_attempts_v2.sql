-- Alert channel transmission attempt attempts (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  notification_job_id   UUID NOT NULL,
  notification_job_created_at TIMESTAMPTZ NOT NULL,
  alert_event_id        UUID NOT NULL,
  connector_id          UUID,
  attempt_number        INTEGER NOT NULL,
  status                notification_job_status NOT NULL,
  response_status_code  INTEGER,
  response_body         TEXT,
  error_category        VARCHAR(64),
  error_message         TEXT,
  duration_ms           INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2_default PARTITION OF alert_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_delivery_attempts_v2_idem
  ON alert_delivery_attempts_v2 (notification_job_id, attempt_number, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_event
  ON alert_delivery_attempts_v2 (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_connector
  ON alert_delivery_attempts_v2 (connector_id, status, created_at DESC)
  WHERE connector_id IS NOT NULL;
