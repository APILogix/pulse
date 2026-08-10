BEGIN;

DROP INDEX IF EXISTS idx_alert_notification_jobs_delivery_mode;
ALTER TABLE alert_notification_jobs
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_restricted_contract,
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_delivery_contract,
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS recipient_type,
  DROP COLUMN IF EXISTS delivery_mode;

COMMIT;
