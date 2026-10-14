-- Deduplication and throttling history for sent alert notifications (range-partitioned by notified_at)
CREATE TABLE IF NOT EXISTS alert_notification_ledger (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  rule_id               UUID,
  rule_action_id        UUID,
  binding_id            UUID,
  channel_kind          notification_channel_kind NOT NULL,
  recipient_user_id     UUID,
  recipient_fingerprint VARCHAR(255) DEFAULT '',
  notified_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notification_job_id   UUID,
  PRIMARY KEY (id, notified_at)
) PARTITION BY RANGE (notified_at);

CREATE TABLE IF NOT EXISTS alert_notification_ledger_default PARTITION OF alert_notification_ledger DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_action_window
  ON alert_notification_ledger (rule_action_id, notified_at DESC)
  WHERE rule_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_alert_window
  ON alert_notification_ledger (alert_key, notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_brin
  ON alert_notification_ledger USING BRIN (notified_at);
