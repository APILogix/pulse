-- =============================================================================
-- Module      : Billing
-- Migration   : 028b6_seed_billing_features_session_replay.sql
-- Description : Seed Session Replay feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('replay.enabled','Session Replay','Enable session replay','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.browser','Browser Replay','Browser session recording','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.mobile','Mobile Replay','Mobile session recording','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.console_logs','Console Logs','Capture browser console logs','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.network','Network Capture','Capture network requests','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.dom_mutations','DOM Mutations','Record DOM mutations','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.user_interactions','User Interactions','Capture clicks, scrolls and input','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.error_linking','Error Linking','Link replays to captured errors','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.trace_linking','Trace Linking','Link replays to distributed traces','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.search','Replay Search','Search replay sessions','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.bookmarks','Replay Bookmarks','Bookmark replay timestamps','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.privacy_masking','Privacy Masking','Mask sensitive UI elements','privacy','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.canvas_capture','Canvas Capture','Capture HTML canvas updates','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('replay.webgl_capture','WebGL Capture','Capture WebGL rendering','feature','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('sampling.replay_dynamic','Dynamic Replay Sampling','Adaptive replay sampling','sampling','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.replay_summaries','AI Replay Summaries','Generate replay summaries','ai','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.replay_anomalies','AI Replay Insights','AI detects abnormal user sessions','ai','replay','boolean','none','{}'::jsonb,TRUE,FALSE),
('quota.monthly_replays','Monthly Replays','Maximum replay sessions','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.replay_retention_days','Replay Retention Days','Maximum replay retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('integration.replay_exports','Replay Export','Export replay recordings','integration','replay','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,name,description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,is_public,is_module_root
FROM feature_seed
ON CONFLICT (feature_key)
DO UPDATE SET
name=EXCLUDED.name,
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