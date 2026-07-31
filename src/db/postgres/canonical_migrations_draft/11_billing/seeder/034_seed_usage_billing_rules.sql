-- =============================================================================
-- Module      : Billing
-- Migration   : 034_seed_usage_billing_rules.sql
-- Description : Seed usage billing, overage, grace period and enforcement rules
-- =============================================================================

BEGIN;

WITH rule_seed(
resource_key,
billing_model,
included_unit,
overage_price_minor,
currency_code,
soft_limit,
hard_limit,
grace_percent,
proration_enabled,
is_metered
) AS (
VALUES
('events','usage','event',15,'USD',TRUE,TRUE,10,TRUE,TRUE),
('logs','usage','gb',25,'USD',TRUE,TRUE,10,TRUE,TRUE),
('traces','usage','trace',10,'USD',TRUE,TRUE,10,TRUE,TRUE),
('metrics','usage','metric',5,'USD',TRUE,TRUE,10,TRUE,TRUE),
('profiles','usage','profile',20,'USD',TRUE,TRUE,5,TRUE,TRUE),
('replays','usage','session',30,'USD',TRUE,TRUE,5,TRUE,TRUE),
('ai_requests','usage','request',2,'USD',TRUE,TRUE,5,TRUE,TRUE),
('ai_credits','usage','credit',1,'USD',TRUE,TRUE,0,FALSE,TRUE),
('members','seat','seat',1000,'USD',FALSE,FALSE,0,TRUE,FALSE),
('projects','feature','project',500,'USD',FALSE,FALSE,0,TRUE,FALSE)
)

INSERT INTO billing_usage_rules(
resource_key,
billing_model,
included_unit,
overage_price_minor,
currency_code,
soft_limit_enabled,
hard_limit_enabled,
grace_percent,
proration_enabled,
is_metered
)
SELECT *
FROM rule_seed
ON CONFLICT(resource_key)
DO UPDATE SET
billing_model=EXCLUDED.billing_model,
included_unit=EXCLUDED.included_unit,
overage_price_minor=EXCLUDED.overage_price_minor,
currency_code=EXCLUDED.currency_code,
soft_limit_enabled=EXCLUDED.soft_limit_enabled,
hard_limit_enabled=EXCLUDED.hard_limit_enabled,
grace_percent=EXCLUDED.grace_percent,
proration_enabled=EXCLUDED.proration_enabled,
is_metered=EXCLUDED.is_metered,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;