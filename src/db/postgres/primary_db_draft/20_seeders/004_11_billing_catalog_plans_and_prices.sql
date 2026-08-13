-- =============================================================================
-- Seeder File: 004_11_billing_catalog_plans_and_prices.sql
-- Description: Seeds JSON-derived subscription plans and plan prices
-- Catalog Version: 2.0
-- Source: billing_catalog_response.preview.json
-- =============================================================================

WITH plan_seed(key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order) AS (
VALUES
  ('free', 1, 'Free', 'free'::billing_plan_tier, 'Perfect for personal projects, prototypes and evaluation. One organization per user.', 0, TRUE, TRUE, FALSE, 'starter', NULL, 1),
  ('starter', 1, 'Starter', 'starter'::billing_plan_tier, 'Production-ready observability for small teams. One organization per user.', 14, TRUE, TRUE, FALSE, 'growth', 'Popular', 2),
  ('growth', 1, 'Growth', 'growth'::billing_plan_tier, 'Scaling teams requiring advanced observability and AI capabilities. One organization per user.', 14, TRUE, TRUE, FALSE, 'business', 'Recommended', 3),
  ('business', 1, 'Business', 'business'::billing_plan_tier, 'Enterprise-ready monitoring with governance, security and automation. One organization per user.', 14, TRUE, TRUE, FALSE, 'enterprise', 'Best Value', 4),
  ('enterprise', 1, 'Enterprise', 'enterprise'::billing_plan_tier, 'Custom enterprise deployment with unlimited scale and dedicated support. One organization per user.', 30, FALSE, TRUE, TRUE, NULL, NULL, 5)
)
INSERT INTO plans
  (key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order)
SELECT key, version, name, tier, description, trial_days, is_public, is_active, is_customizable, next_plan_key, badge, sort_order
FROM plan_seed
ON CONFLICT (key, version) DO UPDATE
SET name = EXCLUDED.name,
    tier = EXCLUDED.tier,
    description = EXCLUDED.description,
    trial_days = EXCLUDED.trial_days,
    is_public = EXCLUDED.is_public,
    is_active = EXCLUDED.is_active,
    is_customizable = EXCLUDED.is_customizable,
    next_plan_key = EXCLUDED.next_plan_key,
    badge = EXCLUDED.badge,
    sort_order = EXCLUDED.sort_order,
    deleted_at = NULL,
    updated_at = NOW();

WITH price_seed(plan_key, provider, billing_interval, currency, amount_minor, is_default, metadata) AS (
VALUES
  ('free', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 0, TRUE, '{"display":"$0/mo","recommended":false}'::jsonb),
  ('free', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 0, FALSE, '{"display":"$0/year","discount":"2 months free"}'::jsonb),
  ('starter', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 1500, TRUE, '{"display":"$15/mo","recommended":false}'::jsonb),
  ('starter', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 15000, FALSE, '{"display":"$150/year","discount":"2 months free"}'::jsonb),
  ('growth', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 4900, TRUE, '{"display":"$49/mo","recommended":true}'::jsonb),
  ('growth', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 49000, FALSE, '{"display":"$490/year","discount":"2 months free"}'::jsonb),
  ('business', 'stripe'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 14900, TRUE, '{"display":"$149/mo","recommended":false}'::jsonb),
  ('business', 'stripe'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 149000, FALSE, '{"display":"$1490/year","discount":"2 months free"}'::jsonb),
  ('enterprise', 'system'::billing_provider_type, 'monthly'::billing_interval_type, 'USD', 0, TRUE, '{"display":"Contact Sales","contactSales":true}'::jsonb),
  ('enterprise', 'system'::billing_provider_type, 'annual'::billing_interval_type, 'USD', 0, FALSE, '{"display":"Contact Sales","contactSales":true}'::jsonb)
)
INSERT INTO plan_prices
  (plan_id, provider, billing_interval, currency, amount_minor, provider_price_id, is_default, starts_at, ends_at, metadata)
SELECT p.id, ps.provider, ps.billing_interval, ps.currency, ps.amount_minor, NULL::text, ps.is_default, '-infinity'::timestamptz, NULL::timestamptz, ps.metadata
FROM price_seed ps
JOIN plans p ON p.key = ps.plan_key AND p.version = 1 AND p.deleted_at IS NULL
ON CONFLICT (plan_id, provider, billing_interval, currency, starts_at) DO UPDATE
SET amount_minor = EXCLUDED.amount_minor,
    provider_price_id = EXCLUDED.provider_price_id,
    is_default = EXCLUDED.is_default,
    ends_at = EXCLUDED.ends_at,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = NOW();
