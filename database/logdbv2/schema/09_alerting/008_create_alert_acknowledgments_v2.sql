-- Human operator alert acknowledgment log (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  user_id               UUID NOT NULL,
  comment               TEXT,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2_default PARTITION OF alert_acknowledgments_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_alert
  ON alert_acknowledgments_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_org
  ON alert_acknowledgments_v2 (organization_id, created_at DESC);
