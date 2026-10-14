-- Normalized final definition for addon_prices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/addons_prices.sql

CREATE TABLE IF NOT EXISTS addon_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  provider billing_provider_type NOT NULL DEFAULT 'system',
  billing_interval billing_interval_type NOT NULL DEFAULT 'monthly',
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  provider_price_id VARCHAR(150),
  pricing_model VARCHAR(20) NOT NULL DEFAULT 'flat'
  CHECK (pricing_model IN ('flat','per_unit','tiered')),
  unit_quantity INTEGER,
  unit_label VARCHAR(50),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_addon_price UNIQUE (addon_id, provider, billing_interval, currency, starts_at)
);
