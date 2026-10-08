-- Normalized final definition for coupon_applicable_plans.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/018_coupon_applicable_plans.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS coupon_applicable_plans
(
  coupon_id UUID NOT NULL
  REFERENCES coupons(id)
  ON DELETE CASCADE,
  plan_id UUID NOT NULL
  REFERENCES plans(id)
  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (coupon_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_applicable_plans_plan
  ON coupon_applicable_plans(plan_id);
