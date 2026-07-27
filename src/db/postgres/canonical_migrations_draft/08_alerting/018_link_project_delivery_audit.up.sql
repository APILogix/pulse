BEGIN;

ALTER TABLE alert_delivery_attempts
  ADD COLUMN IF NOT EXISTS project_alert_channel_id UUID
    REFERENCES project_alert_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_project_channel
  ON alert_delivery_attempts(project_alert_channel_id,created_at DESC)
  WHERE project_alert_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_recipient
  ON alert_delivery_attempts(recipient_user_id,created_at DESC)
  WHERE recipient_user_id IS NOT NULL;

COMMENT ON COLUMN alert_delivery_attempts.project_alert_channel_id IS
  'Project channel that materialized this delivery attempt.';
COMMENT ON COLUMN alert_delivery_attempts.recipient_user_id IS
  'Active project member selected by channel preferences.';

COMMIT;
