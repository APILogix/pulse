-- AI Credit System & Ledger Schema
-- File: 12_ai/001_ai_credit_system.sql

CREATE TABLE IF NOT EXISTS credit_balances (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
  reserved NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount NUMERIC(14,4) NOT NULL,
  balance_after NUMERIC(14,4) NOT NULL,
  transaction_type VARCHAR(64) NOT NULL,
  reference_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(128) NOT NULL,
  prompt_token_cost NUMERIC(12,6) NOT NULL DEFAULT 0.000000,
  completion_token_cost NUMERIC(12,6) NOT NULL DEFAULT 0.000000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
