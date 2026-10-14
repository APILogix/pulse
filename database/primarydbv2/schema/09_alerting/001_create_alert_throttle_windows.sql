-- Normalized final definition for alert_throttle_windows.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_throttle_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_action_id UUID NOT NULL REFERENCES alert_rule_actions(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_throttle_window UNIQUE (rule_action_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_alert_throttle_windows_action
  ON alert_throttle_windows(rule_action_id, window_start DESC);
