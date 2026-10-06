-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_billing_features_updated_at ON billing_features;
CREATE TRIGGER trg_billing_features_updated_at
BEFORE UPDATE
ON billing_features
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE
ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_ai/002_credit_balances.up.sql
DROP TRIGGER IF EXISTS trg_credit_balances_updated_at ON credit_balances;
CREATE TRIGGER trg_credit_balances_updated_at
  BEFORE UPDATE ON credit_balances
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
DROP TRIGGER IF EXISTS trg_credit_ledger_append_only ON credit_ledger;
CREATE TRIGGER trg_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW
  EXECUTE FUNCTION credit_ledger_append_only();

-- Source: canonical_migrations_draft/18_ai/004_credit_rules.up.sql
DROP TRIGGER IF EXISTS trg_credit_rules_updated_at ON credit_rules;
CREATE TRIGGER trg_credit_rules_updated_at
  BEFORE UPDATE ON credit_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE
ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_feature_overrides_updated_at ON organization_feature_overrides;
CREATE TRIGGER trg_organization_feature_overrides_updated_at
BEFORE UPDATE
ON organization_feature_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_subscriptions_updated_at ON organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_updated_at
BEFORE UPDATE
ON organization_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_usage_current_period_updated_at ON organization_usage_current_period;
CREATE TRIGGER trg_org_usage_current_period_updated_at
BEFORE UPDATE
ON organization_usage_current_period
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE
ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plan_feature_entitlements_updated_at ON plan_feature_entitlements;
CREATE TRIGGER trg_plan_feature_entitlements_updated_at
BEFORE UPDATE
ON plan_feature_entitlements
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plan_prices_updated_at ON plan_prices;
CREATE TRIGGER trg_plan_prices_updated_at
BEFORE UPDATE
ON plan_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_subscription_addons_updated_at ON subscription_addons;
CREATE TRIGGER trg_subscription_addons_updated_at
BEFORE UPDATE
ON subscription_addons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at ON usage_daily_counters;
CREATE TRIGGER trg_usage_daily_counters_updated_at
BEFORE UPDATE
ON usage_daily_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
