-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 003_credit_ledger.up.sql
-- Description : Append-only ledger of AI credit movements. Idempotent via
--               UNIQUE idempotency_key. UPDATE/DELETE are rejected by trigger;
--               the credit functions may flip status pending -> failed via the
--               'ai.allow_ledger_mutation' transaction-local setting.
-- PostgreSQL  : 16+
-- Depends On  : 002_credit_balances.up.sql
-- =============================================================================

BEGIN;

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

COMMENT ON TABLE credit_ledger IS
  'Append-only, auditable ledger of AI credit movements. Never UPDATE or DELETE rows (status flips by the credit functions excepted).';

CREATE INDEX IF NOT EXISTS idx_credit_ledger_owner
  ON credit_ledger (owner_type, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_request
  ON credit_ledger (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ai_mode
  ON credit_ledger (owner_type, owner_id, ai_mode);

-- Append-only enforcement: reject UPDATE/DELETE unless the caller explicitly
-- opted in for this transaction (only ai_debit_credit/ai_refund_credit do).
CREATE OR REPLACE FUNCTION credit_ledger_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('ai.allow_ledger_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'credit_ledger is append-only: % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_ledger_append_only ON credit_ledger;
CREATE TRIGGER trg_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW
  EXECUTE FUNCTION credit_ledger_append_only();

COMMIT;
