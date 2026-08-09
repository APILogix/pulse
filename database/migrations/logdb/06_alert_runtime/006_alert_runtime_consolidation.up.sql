BEGIN;

ALTER TABLE alert_notification_jobs
  ADD COLUMN IF NOT EXISTS channel_id UUID,
  ADD COLUMN IF NOT EXISTS rule_id UUID,
  ADD COLUMN IF NOT EXISTS binding_id UUID,
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(64) NOT NULL DEFAULT 'alert',
  ADD COLUMN IF NOT EXISTS routing_decision_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_project_channel
  ON alert_notification_jobs (organization_id, project_id, channel_id, created_at DESC)
  WHERE project_id IS NOT NULL AND channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_rule
  ON alert_notification_jobs (organization_id, rule_id, binding_id, created_at DESC)
  WHERE rule_id IS NOT NULL;

COMMIT;
