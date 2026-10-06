-- High-throughput telemetry outbox buffer for downstream workers and external bridges (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id               BIGSERIAL,
  organization_id  UUID NOT NULL,
  project_id       UUID,
  environment      TEXT,
  signal_kind      TEXT NOT NULL,
  event_id         TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fast_path        BOOLEAN NOT NULL DEFAULT false,
  published_at     TIMESTAMPTZ,
  claimed_at       TIMESTAMPTZ,
  claim_owner      TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT telemetry_outbox_environment_string_ck CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT telemetry_outbox_signal_kind_ck CHECK (
    signal_kind IN (
      'request_error_threshold_breached',
      'error_occurred',
      'cron_checkin_missed',
      'metric_anomaly_detected',
      'span_error_detected',
      'alert_domain_event'
    )
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS telemetry_outbox_default PARTITION OF telemetry_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_outbox_idem
  ON telemetry_outbox (organization_id, signal_kind, event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_unpublished
  ON telemetry_outbox (fast_path DESC, created_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_claimed
  ON telemetry_outbox (claimed_at)
  WHERE published_at IS NULL AND claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_alert_unpublished
  ON telemetry_outbox (created_at)
  WHERE published_at IS NULL AND signal_kind = 'alert_domain_event';
