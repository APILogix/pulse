BEGIN;

ALTER TABLE alert_notification_jobs
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(32),
  ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS provider VARCHAR(32);

ALTER TABLE alert_notification_jobs
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_delivery_contract,
  ADD CONSTRAINT ck_alert_notification_jobs_delivery_contract CHECK (
    delivery_mode IS NULL
    OR delivery_mode IN ('NORMAL_CONNECTOR', 'EMAIL_ONLY_RESTRICTED')
  ),
  DROP CONSTRAINT IF EXISTS ck_alert_notification_jobs_restricted_contract,
  ADD CONSTRAINT ck_alert_notification_jobs_restricted_contract CHECK (
    delivery_mode IS NULL
    OR delivery_mode <> 'EMAIL_ONLY_RESTRICTED'
    OR (
      recipient_type = 'PROJECT_OWNER'
      AND provider = 'MANAGED_EMAIL'
      AND channel_kind = 'email'
      AND connector_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_delivery_mode
  ON alert_notification_jobs (organization_id, delivery_mode, status, created_at DESC)
  WHERE delivery_mode IS NOT NULL;

COMMIT;
