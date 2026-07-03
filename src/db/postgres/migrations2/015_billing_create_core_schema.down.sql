BEGIN;

DROP TABLE IF EXISTS coupon_redemptions CASCADE;
DROP TABLE IF EXISTS coupons CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS usage_daily_counters CASCADE;
DROP TABLE IF EXISTS subscription_events CASCADE;
DROP TABLE IF EXISTS organization_subscriptions CASCADE;
DROP TABLE IF EXISTS plans CASCADE;

DROP TYPE IF EXISTS billing_coupon_discount_type;
DROP TYPE IF EXISTS billing_invoice_status;
DROP TYPE IF EXISTS billing_interval_type;
DROP TYPE IF EXISTS billing_provider_type;
DROP TYPE IF EXISTS billing_subscription_status;
DROP TYPE IF EXISTS billing_plan_tier;

COMMIT;
