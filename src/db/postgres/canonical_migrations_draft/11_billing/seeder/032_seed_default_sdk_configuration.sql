-- =============================================================================
-- Module      : Billing
-- Migration   : 032_seed_default_sdk_configuration.sql
-- Description : Seed default SDK configuration for each subscription plan
-- =============================================================================

BEGIN;

WITH sdk_seed(
plan_key,
config_key,
config_value
) AS (
VALUES
-- ================= FREE =================
('free','sampling.trace_rate','0.05'::jsonb),
('free','sampling.error_rate','1.0'::jsonb),
('free','sampling.profile_rate','0.0'::jsonb),
('free','transport.batch_size','50'::jsonb),
('free','transport.flush_interval_ms','5000'::jsonb),
('free','transport.compression','true'::jsonb),
('free','sdk.offline_queue','false'::jsonb),
('free','privacy.data_scrubbing','true'::jsonb),

-- ================= STARTER =================
('starter','sampling.trace_rate','0.10'::jsonb),
('starter','sampling.error_rate','1.0'::jsonb),
('starter','sampling.profile_rate','0.05'::jsonb),
('starter','transport.batch_size','100'::jsonb),
('starter','transport.flush_interval_ms','3000'::jsonb),
('starter','transport.compression','true'::jsonb),
('starter','sdk.offline_queue','true'::jsonb),
('starter','privacy.data_scrubbing','true'::jsonb),

-- ================= GROWTH =================
('growth','sampling.trace_rate','0.20'::jsonb),
('growth','sampling.error_rate','1.0'::jsonb),
('growth','sampling.profile_rate','0.10'::jsonb),
('growth','transport.batch_size','250'::jsonb),
('growth','transport.flush_interval_ms','2000'::jsonb),
('growth','transport.compression','true'::jsonb),
('growth','sdk.offline_queue','true'::jsonb),
('growth','sdk.dynamic_sampling','true'::jsonb),
('growth','privacy.data_scrubbing','true'::jsonb),

-- ================= BUSINESS =================
('business','sampling.trace_rate','0.50'::jsonb),
('business','sampling.error_rate','1.0'::jsonb),
('business','sampling.profile_rate','0.25'::jsonb),
('business','transport.batch_size','500'::jsonb),
('business','transport.flush_interval_ms','1000'::jsonb),
('business','transport.compression','true'::jsonb),
('business','sdk.offline_queue','true'::jsonb),
('business','sdk.dynamic_sampling','true'::jsonb),
('business','privacy.data_scrubbing','true'::jsonb),

-- ================= ENTERPRISE =================
('enterprise','sampling.trace_rate','1.0'::jsonb),
('enterprise','sampling.error_rate','1.0'::jsonb),
('enterprise','sampling.profile_rate','1.0'::jsonb),
('enterprise','transport.batch_size','1000'::jsonb),
('enterprise','transport.flush_interval_ms','500'::jsonb),
('enterprise','transport.compression','true'::jsonb),
('enterprise','sdk.offline_queue','true'::jsonb),
('enterprise','sdk.dynamic_sampling','true'::jsonb),
('enterprise','privacy.data_scrubbing','true'::jsonb),
('enterprise','privacy.capture_headers','true'::jsonb),
('enterprise','privacy.capture_body','true'::jsonb)
)

INSERT INTO sdk_default_configs (
plan_id,
config_key,
config_value
)
SELECT
p.id,
s.config_key,
s.config_value
FROM sdk_seed s
JOIN billing_plans p
ON p.key = s.plan_key
ON CONFLICT (plan_id, config_key)
DO UPDATE SET
config_value = EXCLUDED.config_value,
updated_at = NOW(),
deleted_at = NULL;

COMMIT;