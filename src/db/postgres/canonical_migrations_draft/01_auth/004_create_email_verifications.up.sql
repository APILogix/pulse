BEGIN;

CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'email_verification',
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_verifications_user_purpose_email_key'
  ) THEN
    ALTER TABLE email_verifications
      ADD CONSTRAINT email_verifications_user_purpose_email_key
      UNIQUE (user_id, email, purpose);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_active_token_hash
  ON email_verifications(token_hash)
  WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_purpose_active
  ON email_verifications(user_id, purpose)
  WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_verifications_cleanup
  ON email_verifications(expires_at)
  WHERE verified_at IS NULL;

COMMIT;
