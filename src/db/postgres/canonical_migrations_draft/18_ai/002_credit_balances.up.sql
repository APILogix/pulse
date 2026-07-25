-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 002_credit_balances.up.sql
-- Description : Current AI credit balance per owner (organization or user).
--               Version column supports optimistic locking on concurrent
--               debits; the authoritative mutation path is ai_debit_credit().
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS credit_balances (
  owner_type VARCHAR(20) NOT NULL
    CHECK (owner_type IN ('organization', 'user')),
  owner_id UUID NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_credits BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_type, owner_id)
);

COMMENT ON TABLE credit_balances IS
  'Current AI credit balance per organization or user. Mutated only through ai_debit_credit()/ai_refund_credit().';

DROP TRIGGER IF EXISTS trg_credit_balances_updated_at ON credit_balances;
CREATE TRIGGER trg_credit_balances_updated_at
  BEFORE UPDATE ON credit_balances
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
