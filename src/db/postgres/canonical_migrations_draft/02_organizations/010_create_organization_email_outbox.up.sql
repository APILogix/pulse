BEGIN;

CREATE TABLE IF NOT EXISTS organization_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  email_type VARCHAR(50) NOT NULL DEFAULT 'generic',
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  dedupe_key VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_email_outbox_due
  ON organization_email_outbox(next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_email_outbox_org
  ON organization_email_outbox(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_email_outbox_dedupe
  ON organization_email_outbox(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status <> 'failed';

COMMIT;
