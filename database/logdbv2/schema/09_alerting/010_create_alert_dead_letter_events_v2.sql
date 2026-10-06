-- Alert processing dead-letter queue (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  stage                 VARCHAR(64) NOT NULL,
  source_queue          VARCHAR(128),
  raw_payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  error_stack           TEXT,
  status                VARCHAR(32) NOT NULL DEFAULT 'dead_letter',
  retry_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2_default PARTITION OF alert_dead_letter_events_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_status
  ON alert_dead_letter_events_v2 (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_org
  ON alert_dead_letter_events_v2 (organization_id, created_at DESC);
