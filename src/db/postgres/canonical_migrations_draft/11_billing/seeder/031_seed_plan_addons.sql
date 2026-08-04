-- =============================================================================
-- Module      : Billing
-- Migration   : 031_seed_plan_addons.sql
-- Description : Seed subscription add-ons available for purchase
-- =============================================================================

BEGIN;

WITH addon_seed(
addon_key,
name,
description,
billing_type,
default_price_minor,
currency_code,
is_stackable,
is_active,
metadata
) AS (
VALUES
('events_10m','10M Event Pack','Additional 10 million events','usage',4900,'USD',TRUE,TRUE,'{"events":10000000}'::jsonb),
('logs_100gb','100GB Log Pack','Additional log ingestion','usage',2900,'USD',TRUE,TRUE,'{"logs_gb":100}'::jsonb),
('retention_30d','30 Day Retention','Increase retention by 30 days','feature',1900,'USD',TRUE,TRUE,'{"days":30}'::jsonb),
('ai_credits_100k','100K AI Credits','Additional AI credits','usage',9900,'USD',TRUE,TRUE,'{"credits":100000}'::jsonb),
('extra_project','Extra Project','Adds one additional project','feature',500,'USD',TRUE,TRUE,'{"projects":1}'::jsonb),
('extra_member','Extra Member','Adds one additional member seat','feature',1000,'USD',TRUE,TRUE,'{"members":1}'::jsonb),
('extra_monitor_25','25 Monitors','Adds twenty-five uptime monitors','feature',1500,'USD',TRUE,TRUE,'{"monitors":25}'::jsonb),
('replay_pack','Replay Pack','Additional session replay quota','usage',3900,'USD',TRUE,TRUE,'{"replays":100000}'::jsonb)
)

INSERT INTO subscription_addons(
addon_key,
name,
description,
billing_type,
default_price_minor,
currency_code,
is_stackable,
is_active,
metadata
)
SELECT *
FROM addon_seed
ON CONFLICT (addon_key)
DO UPDATE SET
name=EXCLUDED.name,
description=EXCLUDED.description,
billing_type=EXCLUDED.billing_type,
default_price_minor=EXCLUDED.default_price_minor,
currency_code=EXCLUDED.currency_code,
is_stackable=EXCLUDED.is_stackable,
is_active=EXCLUDED.is_active,
metadata=EXCLUDED.metadata,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;