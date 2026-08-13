-- =============================================================================
-- Module      : Billing
-- Migration   : 020_helper_functions_and_views.sql
-- Description : Helper functions and read models
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

-- ============================================================================
-- Effective entitlement view
-- NOTE:
-- Organization overrides should take precedence over plan entitlements.
-- Subscription add-ons should be added by application logic or a future view.
-- ============================================================================

CREATE OR REPLACE VIEW v_effective_entitlements AS
WITH active_subscriptions AS (
  SELECT DISTINCT ON (organization_id) *
  FROM organization_subscriptions
  WHERE status IN ('trialing','active','past_due')
    AND deleted_at IS NULL
    AND current_period_end > NOW()
  ORDER BY
    organization_id,
    CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
    created_at DESC
),
plan_entitlements AS (
  SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value) AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value) AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value) AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value) AS string_value
  FROM active_subscriptions os
  JOIN plan_feature_entitlements pfe
    ON pfe.plan_id = os.plan_id
   AND pfe.deleted_at IS NULL
  JOIN billing_features bf
    ON bf.id = pfe.feature_id
   AND bf.deleted_at IS NULL
   AND bf.is_deprecated = FALSE
  LEFT JOIN organization_feature_overrides ofo
    ON ofo.organization_id = os.organization_id
   AND ofo.feature_id = bf.id
   AND ofo.deleted_at IS NULL
   AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
),
addon_entitlements AS (
  SELECT
    os.organization_id,
    bf.feature_key,
    CASE WHEN bf.value_type = 'boolean' THEN TRUE ELSE NULL END AS boolean_value,
    CASE WHEN bf.value_type = 'integer' THEN SUM(sa.quantity)::bigint ELSE NULL END AS integer_value,
    CASE WHEN bf.value_type = 'decimal' THEN SUM(sa.quantity)::numeric ELSE NULL END AS decimal_value,
    NULL::text AS string_value
  FROM active_subscriptions os
  JOIN subscription_addons sa
    ON sa.subscription_id = os.id
   AND sa.organization_id = os.organization_id
   AND sa.status = 'active'
   AND sa.starts_at <= NOW()
   AND (sa.expires_at IS NULL OR sa.expires_at > NOW())
  JOIN billing_features bf
    ON bf.id = sa.feature_id
   AND bf.deleted_at IS NULL
   AND bf.is_deprecated = FALSE
  GROUP BY os.organization_id, bf.feature_key, bf.value_type
),
combined AS (
  SELECT * FROM plan_entitlements
  UNION ALL
  SELECT * FROM addon_entitlements
)
SELECT
  organization_id,
  feature_key,
  CASE WHEN BOOL_OR(COALESCE(boolean_value, FALSE)) THEN TRUE ELSE NULL END AS boolean_value,
  NULLIF(SUM(COALESCE(integer_value, 0)), 0)::bigint AS integer_value,
  NULLIF(SUM(COALESCE(decimal_value, 0)), 0)::numeric AS decimal_value,
  MAX(string_value) FILTER (WHERE string_value IS NOT NULL) AS string_value
FROM combined
GROUP BY organization_id, feature_key;

COMMENT ON VIEW v_effective_entitlements IS
'Resolved authoritative organization entitlements merging active subscriptions, plans, overrides, and addons.';

-- ============================================================================
-- Current usage summary
-- ============================================================================

CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    (event_limit - events_used) AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    (ai_credit_limit - ai_credits_used) AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- ============================================================================
-- Subscription summary
-- ============================================================================

CREATE OR REPLACE VIEW v_subscription_summary AS
SELECT
    os.organization_id,
    p.name            AS plan_name,
    p.key             AS plan_key,
    p.tier,
    os.status,
    os.billing_interval,
    os.current_period_start,
    os.current_period_end,
    os.cancel_at_period_end
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id;

-- ============================================================================
-- Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_integer_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT integer_value
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION has_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
SELECT COALESCE(boolean_value,FALSE)
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION remaining_ai_credits(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(ai_credit_limit - ai_credits_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION consume_ai_credits(
    p_organization_id UUID,
    p_credits BIGINT
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET ai_credits_used = ai_credits_used + p_credits,
    last_ai_request_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

COMMIT;
