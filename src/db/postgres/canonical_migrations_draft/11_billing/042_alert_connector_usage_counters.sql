-- =============================================================================
-- Module      : Billing
-- Migration   : 042_alert_connector_usage_counters.sql
-- Description : Add billing-safe alert/connector delivery counters
-- =============================================================================

BEGIN;

ALTER TABLE organization_usage_current_period
  ADD COLUMN IF NOT EXISTS alert_notifications_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS connector_sends_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_sends_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slack_sends_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_sends_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_sends_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_alert_notification_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_connector_send_at TIMESTAMPTZ;

ALTER TABLE organization_usage_current_period
  DROP CONSTRAINT IF EXISTS chk_alert_connector_usage_non_negative;
ALTER TABLE organization_usage_current_period
  ADD CONSTRAINT chk_alert_connector_usage_non_negative CHECK (
    alert_notifications_used >= 0
    AND connector_sends_used >= 0
    AND email_sends_used >= 0
    AND slack_sends_used >= 0
    AND sms_sends_used >= 0
    AND webhook_sends_used >= 0
  );

ALTER TABLE usage_daily_counters
  ADD COLUMN IF NOT EXISTS alert_notifications_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS connector_sends_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_sends_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slack_sends_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_sends_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_sends_count BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN organization_usage_current_period.alert_notifications_used IS
  'Billable alert notifications after delivery decision. Suppressed alerts are not counted.';
COMMENT ON COLUMN organization_usage_current_period.connector_sends_used IS
  'Successful connector sends only. Failed attempts and retry scheduling are not billed.';

COMMIT;
