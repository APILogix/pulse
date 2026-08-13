-- Billing Plans & Features Core Schema
-- File: 07_billing/001_plans_and_features.sql

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  tier billing_plan_tier NOT NULL DEFAULT 'free',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(128) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  category billing_feature_category NOT NULL DEFAULT 'core',
  value_type billing_feature_value_type NOT NULL DEFAULT 'boolean',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  default_value JSONB DEFAULT 'false'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
