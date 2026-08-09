BEGIN;

DROP INDEX IF EXISTS idx_alert_notification_jobs_project_channel;
DROP INDEX IF EXISTS idx_alert_notification_jobs_rule;

ALTER TABLE alert_notification_jobs
  DROP COLUMN IF EXISTS routing_decision_hash,
  DROP COLUMN IF EXISTS notification_type,
  DROP COLUMN IF EXISTS binding_id,
  DROP COLUMN IF EXISTS rule_id,
  DROP COLUMN IF EXISTS channel_id;

COMMIT;
