-- =============================================================================
-- Module      : Billing
-- Migration   : 033_seed_feature_overrides.sql
-- Description : Seed example feature overrides for organizations/projects
-- =============================================================================

BEGIN;

WITH override_seed(
scope_type,
scope_key,
feature_key,
boolean_value,
integer_value,
reason,
expires_in_days
) AS (
VALUES
('organization','demo-org','ai.enabled',TRUE,NULL,'Sales trial',30),
('organization','demo-org','quota.monthly_events',NULL,50000000,'Promotional upgrade',30),
('organization','enterprise-poc','security.scim',TRUE,NULL,'Enterprise evaluation',90),
('organization','enterprise-poc','security.byok',TRUE,NULL,'Enterprise evaluation',90),
('project','critical-api','sampling.trace_rate',NULL,100,'Capture all traces',14),
('project','critical-api','quota.trace_retention_days',NULL,365,'Incident investigation',14)
)

INSERT INTO feature_overrides (
scope_type,
scope_key,
feature_id,
boolean_value,
integer_value,
reason,
starts_at,
expires_at
)
SELECT
o.scope_type,
o.scope_key,
f.id,
o.boolean_value,
o.integer_value,
o.reason,
NOW(),
CASE
    WHEN o.expires_in_days IS NULL THEN NULL
    ELSE NOW() + (o.expires_in_days || ' days')::interval
END
FROM override_seed o
JOIN billing_features f
  ON f.feature_key = o.feature_key
ON CONFLICT (scope_type, scope_key, feature_id)
DO UPDATE SET
boolean_value = EXCLUDED.boolean_value,
integer_value = EXCLUDED.integer_value,
reason = EXCLUDED.reason,
starts_at = EXCLUDED.starts_at,
expires_at = EXCLUDED.expires_at,
updated_at = NOW(),
deleted_at = NULL;

COMMIT;