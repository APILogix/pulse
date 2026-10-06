-- Historical state transitions of alert incidents (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_event_history_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  alert_key             VARCHAR(512) NOT NULL,
  organization_id       UUID NOT NULL,
  from_state            alert_state,
  to_state              alert_state NOT NULL,
  reason                VARCHAR(128) NOT NULL,
  actor_type            VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id              UUID,
  alert_event_id        UUID,
  alert_event_created_at TIMESTAMPTZ,
  context               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_event_history_v2_default PARTITION OF alert_event_history_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_alert
  ON alert_event_history_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_org
  ON alert_event_history_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_event
  ON alert_event_history_v2 (alert_event_id, created_at DESC)
  WHERE alert_event_id IS NOT NULL;
