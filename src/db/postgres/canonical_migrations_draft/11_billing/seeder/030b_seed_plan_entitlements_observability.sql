-- =============================================================================
-- Module      : Billing
-- Migration   : 030b_seed_plan_entitlements_observability.sql
-- Description : Seed observability plan entitlements
-- =============================================================================

BEGIN;

WITH entitlement_seed(plan_key, feature_key, bool_value, int_value) AS (
VALUES
-- Free
('free','error_tracking.enabled',TRUE,NULL),
('free','logging.enabled',TRUE,NULL),
('free','metrics.enabled',TRUE,NULL),
('free','quota.monthly_logs',NULL,100000),
('free','quota.monthly_metrics',NULL,100000),
('free','quota.monthly_profiles',NULL,0),
('free','quota.monthly_replays',NULL,0),

-- Starter
('starter','error_tracking.enabled',TRUE,NULL),
('starter','tracing.enabled',TRUE,NULL),
('starter','logging.enabled',TRUE,NULL),
('starter','metrics.enabled',TRUE,NULL),
('starter','tracing.service_map',TRUE,NULL),
('starter','logging.search',TRUE,NULL),
('starter','quota.monthly_logs',NULL,1000000),
('starter','quota.monthly_metrics',NULL,1000000),
('starter','quota.monthly_profiles',NULL,50000),
('starter','quota.monthly_replays',NULL,1000),

-- Growth
('growth','error_tracking.enabled',TRUE,NULL),
('growth','tracing.enabled',TRUE,NULL),
('growth','logging.enabled',TRUE,NULL),
('growth','metrics.enabled',TRUE,NULL),
('growth','profiling.enabled',TRUE,NULL),
('growth','replay.enabled',TRUE,NULL),
('growth','uptime.enabled',TRUE,NULL),
('growth','cron.enabled',TRUE,NULL),
('growth','tracing.service_map',TRUE,NULL),
('growth','logging.live_tail',TRUE,NULL),
('growth','metrics.metric_math',TRUE,NULL),
('growth','quota.monthly_logs',NULL,10000000),
('growth','quota.monthly_metrics',NULL,10000000),
('growth','quota.monthly_profiles',NULL,500000),
('growth','quota.monthly_replays',NULL,25000),
('growth','quota.monitors',NULL,25),
('growth','quota.cron_monitors',NULL,25),

-- Business
('business','error_tracking.enabled',TRUE,NULL),
('business','tracing.enabled',TRUE,NULL),
('business','logging.enabled',TRUE,NULL),
('business','metrics.enabled',TRUE,NULL),
('business','profiling.enabled',TRUE,NULL),
('business','replay.enabled',TRUE,NULL),
('business','uptime.enabled',TRUE,NULL),
('business','cron.enabled',TRUE,NULL),
('business','tracing.live_traces',TRUE,NULL),
('business','logging.archives',TRUE,NULL),
('business','metrics.recording_rules',TRUE,NULL),
('business','profiling.trace_correlation',TRUE,NULL),
('business','replay.trace_linking',TRUE,NULL),
('business','quota.monthly_logs',NULL,100000000),
('business','quota.monthly_metrics',NULL,100000000),
('business','quota.monthly_profiles',NULL,5000000),
('business','quota.monthly_replays',NULL,250000),
('business','quota.monitors',NULL,100),
('business','quota.cron_monitors',NULL,100),

-- Enterprise
('enterprise','error_tracking.enabled',TRUE,NULL),
('enterprise','tracing.enabled',TRUE,NULL),
('enterprise','logging.enabled',TRUE,NULL),
('enterprise','metrics.enabled',TRUE,NULL),
('enterprise','profiling.enabled',TRUE,NULL),
('enterprise','replay.enabled',TRUE,NULL),
('enterprise','uptime.enabled',TRUE,NULL),
('enterprise','cron.enabled',TRUE,NULL),
('enterprise','tracing.live_traces',TRUE,NULL),
('enterprise','tracing.trace_compare',TRUE,NULL),
('enterprise','logging.archives',TRUE,NULL),
('enterprise','logging.pipelines',TRUE,NULL),
('enterprise','metrics.recording_rules',TRUE,NULL),
('enterprise','metrics.exemplars',TRUE,NULL),
('enterprise','profiling.trace_correlation',TRUE,NULL),
('enterprise','replay.trace_linking',TRUE,NULL),
('enterprise','quota.monthly_logs',NULL,1000000000),
('enterprise','quota.monthly_metrics',NULL,1000000000),
('enterprise','quota.monthly_profiles',NULL,50000000),
('enterprise','quota.monthly_replays',NULL,1000000),
('enterprise','quota.monitors',NULL,1000),
('enterprise','quota.cron_monitors',NULL,1000)
)

INSERT INTO billing_plan_entitlements
(plan_id,feature_id,boolean_value,integer_value)
SELECT p.id,f.id,e.bool_value,e.int_value
FROM entitlement_seed e
JOIN billing_plans p ON p.key=e.plan_key
JOIN billing_features f ON f.feature_key=e.feature_key
ON CONFLICT(plan_id,feature_id)
DO UPDATE SET
boolean_value=EXCLUDED.boolean_value,
integer_value=EXCLUDED.integer_value,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;