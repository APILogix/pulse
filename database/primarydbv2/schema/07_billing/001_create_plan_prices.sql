-- Normalized final definition for plan_prices.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/003_plan_prices.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql

CREATE TABLE IF NOT EXISTS plan_prices
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  provider billing_provider_type NOT NULL,
  billing_interval billing_interval_type NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL
  CHECK (amount_minor >= 0),
  provider_price_id VARCHAR(150),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  country_code CHAR(2),
  region_code VARCHAR(50),
  tax_behavior billing_tax_behavior
  NOT NULL DEFAULT 'unspecified',
  is_promotional BOOLEAN
  NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_plan_price UNIQUE
  (
  plan_id,
  provider,
  billing_interval,
  currency,
  starts_at
  ),
  CONSTRAINT chk_plan_price_window
  CHECK
  (
  ends_at IS NULL
  OR starts_at IS NULL
  OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_plan_prices_plan
ON plan_prices(plan_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_provider
ON plan_prices(provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_currency
ON plan_prices(currency)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_interval
ON plan_prices(billing_interval)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_lookup
ON plan_prices
(
    plan_id,
    provider,
    billing_interval,
    currency
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_prices_default
ON plan_prices
(
    plan_id,
    billing_interval,
    currency
)
WHERE is_default = TRUE
AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price
ON plan_prices
(
    provider,
    provider_price_id
)
WHERE provider_price_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_active_window
ON plan_prices
(
    starts_at,
    ends_at
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_prices_region
ON plan_prices
(
    country_code,
    region_code
)
WHERE deleted_at IS NULL;
