-- Entitlement & Usage Aggregation Views
-- File: 17_views/001_entitlement_and_usage_views.sql

CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
  sub.organization_id,
  f.key AS feature_key,
  f.name AS feature_name,
  f.category AS feature_category,
  COALESCE(ov.is_enabled, pfe.is_enabled, false) AS is_enabled,
  COALESCE(ov.value_override, pfe.value_limit, f.default_value) AS effective_value,
  CASE WHEN ov.id IS NOT NULL THEN 'override' ELSE 'plan' END AS entitlement_source
FROM organization_subscriptions sub
JOIN plans p ON p.id = sub.plan_id
JOIN plan_feature_entitlements pfe ON pfe.plan_id = p.id
JOIN features f ON f.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ov ON ov.organization_id = sub.organization_id
  AND ov.feature_id = f.id
  AND (ov.expires_at IS NULL OR ov.expires_at > NOW())
WHERE sub.status IN ('active', 'trialing');

CREATE OR REPLACE VIEW v_current_usage AS
SELECT
  udc.organization_id,
  udc.metric_key,
  SUM(udc.count_value) AS total_count,
  MIN(udc.date_bucket) AS period_start,
  MAX(udc.date_bucket) AS period_end
FROM usage_daily_counters udc
GROUP BY udc.organization_id, udc.metric_key;
