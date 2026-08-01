-- =============================================================================
-- Module      : Billing
-- Migration   : 030a_seed_plan_entitlements_core.sql
-- Description : Seed core plan entitlements (Organization, Projects, SDK, Core)
-- =============================================================================

BEGIN;

WITH entitlement_seed(plan_key, feature_key, value_boolean, value_integer) AS (
VALUES
-- ===== FREE =====
('free','organization.enabled',TRUE,NULL),
('free','projects.enabled',TRUE,NULL),
('free','sdk.enabled',TRUE,NULL),
('free','quota.projects',NULL,1),
('free','quota.members',NULL,3),
('free','quota.api_keys',NULL,2),
('free','quota.environments',NULL,2),
('free','quota.monthly_events',NULL,100000),
('free','quota.requests_per_second',NULL,50),

-- ===== STARTER =====
('starter','organization.enabled',TRUE,NULL),
('starter','projects.enabled',TRUE,NULL),
('starter','sdk.enabled',TRUE,NULL),
('starter','sdk.remote_config',TRUE,NULL),
('starter','sdk.retry',TRUE,NULL),
('starter','sdk.batching',TRUE,NULL),
('starter','quota.projects',NULL,5),
('starter','quota.members',NULL,10),
('starter','quota.api_keys',NULL,10),
('starter','quota.environments',NULL,5),
('starter','quota.monthly_events',NULL,1000000),
('starter','quota.requests_per_second',NULL,250),

-- ===== GROWTH =====
('growth','organization.enabled',TRUE,NULL),
('growth','projects.enabled',TRUE,NULL),
('growth','sdk.enabled',TRUE,NULL),
('growth','sdk.remote_config',TRUE,NULL),
('growth','sdk.retry',TRUE,NULL),
('growth','sdk.batching',TRUE,NULL),
('growth','sdk.offline_queue',TRUE,NULL),
('growth','sdk.dynamic_sampling',TRUE,NULL),
('growth','privacy.data_scrubbing',TRUE,NULL),
('growth','quota.projects',NULL,25),
('growth','quota.members',NULL,50),
('growth','quota.api_keys',NULL,50),
('growth','quota.environments',NULL,10),
('growth','quota.monthly_events',NULL,10000000),
('growth','quota.requests_per_second',NULL,1000),

-- ===== BUSINESS =====
('business','organization.enabled',TRUE,NULL),
('business','projects.enabled',TRUE,NULL),
('business','sdk.enabled',TRUE,NULL),
('business','sdk.remote_config',TRUE,NULL),
('business','sdk.retry',TRUE,NULL),
('business','sdk.batching',TRUE,NULL),
('business','sdk.offline_queue',TRUE,NULL),
('business','sdk.dynamic_sampling',TRUE,NULL),
('business','privacy.data_scrubbing',TRUE,NULL),
('business','privacy.capture_headers',TRUE,NULL),
('business','privacy.capture_body',TRUE,NULL),
('business','quota.projects',NULL,100),
('business','quota.members',NULL,250),
('business','quota.api_keys',NULL,250),
('business','quota.environments',NULL,25),
('business','quota.monthly_events',NULL,100000000),
('business','quota.requests_per_second',NULL,5000),

-- ===== ENTERPRISE =====
('enterprise','organization.enabled',TRUE,NULL),
('enterprise','projects.enabled',TRUE,NULL),
('enterprise','sdk.enabled',TRUE,NULL),
('enterprise','sdk.remote_config',TRUE,NULL),
('enterprise','sdk.retry',TRUE,NULL),
('enterprise','sdk.batching',TRUE,NULL),
('enterprise','sdk.offline_queue',TRUE,NULL),
('enterprise','sdk.dynamic_sampling',TRUE,NULL),
('enterprise','privacy.data_scrubbing',TRUE,NULL),
('enterprise','privacy.capture_headers',TRUE,NULL),
('enterprise','privacy.capture_body',TRUE,NULL),
('enterprise','privacy.capture_ip',TRUE,NULL),
('enterprise','quota.projects',NULL,1000),
('enterprise','quota.members',NULL,10000),
('enterprise','quota.api_keys',NULL,1000),
('enterprise','quota.environments',NULL,100),
('enterprise','quota.monthly_events',NULL,1000000000),
('enterprise','quota.requests_per_second',NULL,50000)
)

INSERT INTO plan_feature_entitlements
(plan_id, feature_id, boolean_value, integer_value)
SELECT
p.id,
f.id,
e.value_boolean,
e.value_integer
FROM entitlement_seed e
JOIN plans p ON p.key = e.plan_key
JOIN billing_features f ON f.feature_key = e.feature_key
ON CONFLICT (plan_id, feature_id)
DO UPDATE SET
boolean_value = EXCLUDED.boolean_value,
integer_value = EXCLUDED.integer_value,
updated_at = NOW(),
deleted_at = NULL;

COMMIT;
