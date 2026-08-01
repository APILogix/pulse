-- =============================================================================
-- Module      : Billing
-- Migration   : 028a3_seed_billing_features_sdk.sql
-- Description : Seed SDK, transport, sampling and privacy billing features
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
-- SDK
('sdk.enabled','SDK Enabled','Enable SDK ingestion','sdk','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),
('sdk.remote_config','Remote Configuration','Allow dynamic SDK configuration','sdk','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),
('sdk.offline_queue','Offline Queue','Persist events locally when offline','sdk','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),
('sdk.batching','Batching','Batch event delivery','sdk','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),
('sdk.retry','Retry','Retry failed deliveries','sdk','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),
('sdk.dynamic_sampling','Dynamic Sampling','Enable dynamic sampling','sampling','sdk','boolean','none','{}'::jsonb,TRUE,FALSE),

-- Sampling
('sampling.error_rate','Error Sampling Rate','Error sampling percentage','sampling','sampling','decimal','none','{"min":0,"max":1}'::jsonb,TRUE,FALSE),
('sampling.trace_rate','Trace Sampling Rate','Trace sampling percentage','sampling','sampling','decimal','none','{"min":0,"max":1}'::jsonb,TRUE,FALSE),
('sampling.profile_rate','Profile Sampling Rate','Profile sampling percentage','sampling','sampling','decimal','none','{"min":0,"max":1}'::jsonb,TRUE,FALSE),
('sampling.session_replay_rate','Replay Sampling Rate','Session replay sampling percentage','sampling','sampling','decimal','none','{"min":0,"max":1}'::jsonb,TRUE,FALSE),

-- Transport
('transport.compression','Compression','Compress outbound payloads','transport','transport','boolean','none','{}'::jsonb,TRUE,FALSE),
('transport.http2','HTTP/2','HTTP/2 transport support','transport','transport','boolean','none','{}'::jsonb,TRUE,FALSE),
('transport.keep_alive','Keep Alive','Persistent transport connections','transport','transport','boolean','none','{}'::jsonb,TRUE,FALSE),
('transport.max_batch_size','Maximum Batch Size','Maximum events per batch','transport','transport','integer','hard_limit','{"unit":"events"}'::jsonb,TRUE,FALSE),
('transport.flush_interval_ms','Flush Interval','Flush interval in milliseconds','transport','transport','integer','none','{"unit":"ms"}'::jsonb,TRUE,FALSE),

-- Privacy
('privacy.capture_headers','Capture Headers','Capture HTTP headers','privacy','privacy','boolean','none','{}'::jsonb,TRUE,FALSE),
('privacy.capture_body','Capture Request Body','Capture request body','privacy','privacy','boolean','none','{}'::jsonb,TRUE,FALSE),
('privacy.capture_ip','Capture Client IP','Capture client IP address','privacy','privacy','boolean','none','{}'::jsonb,TRUE,FALSE),
('privacy.data_scrubbing','Data Scrubbing','Automatic PII scrubbing','privacy','privacy','boolean','none','{}'::jsonb,TRUE,FALSE),

-- Instrumentation
('instrumentation.http','HTTP Instrumentation','Automatic HTTP instrumentation','instrumentation','instrumentation','boolean','none','{}'::jsonb,TRUE,FALSE),
('instrumentation.express','Express Instrumentation','Express auto instrumentation','instrumentation','instrumentation','boolean','none','{}'::jsonb,TRUE,FALSE),
('instrumentation.fastify','Fastify Instrumentation','Fastify auto instrumentation','instrumentation','instrumentation','boolean','none','{}'::jsonb,TRUE,FALSE),
('instrumentation.database','Database Instrumentation','SQL instrumentation','instrumentation','instrumentation','boolean','none','{}'::jsonb,TRUE,FALSE),
('instrumentation.redis','Redis Instrumentation','Redis instrumentation','instrumentation','instrumentation','boolean','none','{}'::jsonb,TRUE,FALSE),

-- Kill Switches
('killswitch.sdk','SDK Kill Switch','Disable SDK remotely','killswitch','killswitch','boolean','none','{}'::jsonb,TRUE,FALSE),
('killswitch.tracing','Tracing Kill Switch','Disable tracing remotely','killswitch','killswitch','boolean','none','{}'::jsonb,TRUE,FALSE),
('killswitch.logging','Logging Kill Switch','Disable logging remotely','killswitch','killswitch','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,feature_name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,
name,
description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,
is_public,
is_module_root
FROM feature_seed
ON CONFLICT (feature_key)
DO UPDATE SET
feature_name=EXCLUDED.feature_name,
description=EXCLUDED.description,
category=EXCLUDED.category,
module=EXCLUDED.module,
value_type=EXCLUDED.value_type,
usage_behavior=EXCLUDED.usage_behavior,
configuration=EXCLUDED.configuration,
is_public=EXCLUDED.is_public,
is_module_root=EXCLUDED.is_module_root,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;
