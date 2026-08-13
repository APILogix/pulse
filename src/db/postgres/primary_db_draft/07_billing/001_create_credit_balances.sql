-- Normalized final definition for credit_balances.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_ai/002_credit_balances.up.sql
-- - canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql

CREATE TABLE IF NOT EXISTS credit_balances (
  owner_type VARCHAR(20) NOT NULL
  CHECK (owner_type IN ('organization', 'user')),
  owner_id UUID NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_credits BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlimited BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (owner_type, owner_id)
);
