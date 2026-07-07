BEGIN;

CREATE TABLE IF NOT EXISTS auth_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  template_name VARCHAR(100),
  template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_pending
  ON auth_email_outbox(next_attempt_at, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_processing_started
  ON auth_email_outbox(processing_started_at)
  WHERE status = 'pending' AND processing_started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_sent_cleanup
  ON auth_email_outbox(sent_at)
  WHERE status = 'sent' AND sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_failed_cleanup
  ON auth_email_outbox(created_at)
  WHERE status = 'failed';

COMMIT;
