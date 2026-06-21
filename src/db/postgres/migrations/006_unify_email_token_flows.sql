-- Use email_verifications as the single source of truth for all email token flows.
-- Application code purpose-binds token hashes, so the table does not need a
-- separate purpose column to prevent cross-route token replay.

ALTER TABLE users
  ALTER COLUMN email_verified SET DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_unique
  ON email_verifications(token_hash)
  WHERE verified_at IS NULL;

COMMENT ON TABLE email_verifications IS
  'Shared token table for email verification, password reset, and future email token flows. verified_at is the token consumed timestamp.';

DROP TABLE IF EXISTS password_resets;
