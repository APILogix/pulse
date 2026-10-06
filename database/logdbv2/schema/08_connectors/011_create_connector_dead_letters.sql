-- Dead-lettered connector notification deliveries for inspection and replay (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_dead_letters (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID,
  delivery_created_at   TIMESTAMPTZ,
  channel_kind          notification_channel_kind,
  notification_job_id   UUID,
  alert_event_id        UUID,
  last_error_category   VARCHAR(64),
  last_error_message    TEXT,
  total_attempts        INTEGER NOT NULL DEFAULT 0,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  replayed_at           TIMESTAMPTZ,
  replayed_by           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_dead_letters_default PARTITION OF connector_dead_letters DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_connector
  ON connector_dead_letters (connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_unreplayed
  ON connector_dead_letters (organization_id, created_at DESC)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_delivery
  ON connector_dead_letters (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;
