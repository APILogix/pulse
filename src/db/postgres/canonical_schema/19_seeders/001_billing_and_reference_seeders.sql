-- Canonical Billing & Reference Seed Data
-- File: 19_seeders/001_billing_and_reference_seeders.sql

-- 1. Insert Reference Plans
INSERT INTO plans (id, name, code, tier, description, is_active, is_public, sort_order)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Free Developer', 'free', 'free', 'Free tier for personal projects and small prototypes.', true, true, 1),
  ('10000000-0000-4000-8000-000000000002', 'Pro Team', 'pro', 'pro', 'For growing teams requiring enhanced limits and connectors.', true, true, 2),
  ('10000000-0000-4000-8000-000000000003', 'Enterprise', 'enterprise', 'enterprise', 'Custom SLAs, SSO SAML, SCIM, and dedicated support.', true, true, 3)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 2. Insert Core Features
INSERT INTO features (id, key, name, category, value_type, description, is_active, default_value)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'retention_days', 'Data Retention (Days)', 'core', 'numeric', 'Number of days telemetry data is retained', true, '7'::jsonb),
  ('20000000-0000-4000-8000-000000000002', 'monthly_events_limit', 'Monthly Ingestion Events', 'observability', 'numeric', 'Monthly allowed ingestion events quota', true, '100000'::jsonb),
  ('20000000-0000-4000-8000-000000000003', 'sso_saml', 'SSO / SAML Authentication', 'security', 'boolean', 'Single Sign-On integration support', true, 'false'::jsonb),
  ('20000000-0000-4000-8000-000000000004', 'ai_credits_monthly', 'Monthly AI Intelligence Credits', 'ai', 'numeric', 'Monthly AI prompt & analysis credit quota', true, '50'::jsonb),
  ('20000000-0000-4000-8000-000000000005', 'custom_alert_channels', 'Custom Alert Connectors', 'alerting', 'boolean', 'Ability to create custom webhook/pagerduty alert channels', true, 'false'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 3. Seed Plan Prices
INSERT INTO plan_prices (plan_id, currency, amount, interval_type, interval_count)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'USD', 0.00, 'monthly', 1),
  ('10000000-0000-4000-8000-000000000002', 'USD', 49.00, 'monthly', 1),
  ('10000000-0000-4000-8000-000000000003', 'USD', 499.00, 'monthly', 1)
ON CONFLICT DO NOTHING;

-- 4. Seed Free Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', true, '7'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', true, '100000'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', false, 'false'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', true, '50'::jsonb),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', false, 'false'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();

-- 5. Seed Pro Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', true, '30'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', true, '2500000'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', false, 'false'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', true, '1000'::jsonb),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', true, 'true'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();

-- 6. Seed Enterprise Plan Entitlements
INSERT INTO plan_feature_entitlements (plan_id, feature_id, is_enabled, value_limit)
VALUES
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', true, '90'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', true, '50000000'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', true, 'true'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', true, '50000'::jsonb),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000005', true, 'true'::jsonb)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  value_limit = EXCLUDED.value_limit,
  updated_at = NOW();
