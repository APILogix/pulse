-- Normalized final definition for tmp_enterprise_billing_feature_seed.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql

CREATE TEMP TABLE IF NOT EXISTS tmp_enterprise_billing_feature_seed
(
  feature_key     VARCHAR(100) PRIMARY KEY,
  feature_name    VARCHAR(150) NOT NULL,
  description     TEXT,
  category        billing_feature_category NOT NULL,
  value_type      billing_feature_value_type NOT NULL,
  module          VARCHAR(50),
  is_module_root  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  free_value      TEXT NOT NULL,
  starter_value   TEXT NOT NULL,
  growth_value    TEXT NOT NULL,
  business_value  TEXT NOT NULL,
  enterprise_value TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT PRESERVE ROWS;
