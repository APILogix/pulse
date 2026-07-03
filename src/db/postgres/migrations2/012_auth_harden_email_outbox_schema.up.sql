-- ============================================================================
-- 012_auth_harden_email_outbox_schema.up.sql
-- ----------------------------------------------------------------------------
-- Hardens the auth email outbox for multi-worker execution and bounded growth.
--
-- Why:
--   * Multiple workers can poll auth_email_outbox concurrently.
--   * We need a durable "processing" claim timestamp so stale claims can be
--     recovered after a worker crash.
--   * We need purge-friendly indexes so sent/failed rows can be deleted in
--     bounded background jobs and the table does not grow forever.
-- ============================================================================

BEGIN;

ALTER TABLE auth_email_outbox
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_processing_started
  ON auth_email_outbox(processing_started_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_sent_cleanup
  ON auth_email_outbox(sent_at)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_failed_cleanup
  ON auth_email_outbox(created_at)
  WHERE status = 'failed';

COMMIT;

