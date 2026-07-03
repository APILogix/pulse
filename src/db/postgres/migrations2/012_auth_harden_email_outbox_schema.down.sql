BEGIN;

DROP INDEX IF EXISTS idx_auth_email_outbox_failed_cleanup;
DROP INDEX IF EXISTS idx_auth_email_outbox_sent_cleanup;
DROP INDEX IF EXISTS idx_auth_email_outbox_processing_started;

ALTER TABLE auth_email_outbox
  DROP COLUMN IF EXISTS processing_started_at;

COMMIT;
