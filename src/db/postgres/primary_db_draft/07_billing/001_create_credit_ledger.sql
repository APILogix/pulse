-- Normalized final definition for credit_ledger.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
-- - canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql

CREATE TABLE IF NOT EXISTS credit_ledger (
  ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type VARCHAR(20) NOT NULL
  CHECK (owner_type IN ('organization', 'user')),
  owner_id UUID NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  ai_mode TEXT,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  direction VARCHAR(10) NOT NULL
  CHECK (direction IN ('debit', 'credit', 'refund')),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
  CHECK (status IN ('pending', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_owner
  ON credit_ledger (owner_type, owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_request
  ON credit_ledger (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_ledger_ai_mode
  ON credit_ledger (owner_type, owner_id, ai_mode);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_owner_idempotency
  ON credit_ledger (owner_type, owner_id, idempotency_key);
