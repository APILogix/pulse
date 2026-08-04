-- =============================================================================
-- Module      : Billing
-- Migration   : 028b1_seed_billing_features_error_tracking.sql
-- Description : Seed Error Tracking feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('error_tracking.enabled','Error Tracking','Enable error monitoring','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.issue_grouping','Issue Grouping','Automatic issue grouping','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.stack_traces','Stack Traces','Capture stack traces','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.source_maps','Source Maps','Upload and resolve source maps','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.release_tracking','Release Tracking','Track releases and deployments','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.release_health','Release Health','Release crash-free sessions','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.regressions','Regression Detection','Detect recurring regressions','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.fingerprinting','Custom Fingerprinting','Custom grouping fingerprints','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.inbound_filters','Inbound Filters','Drop unwanted events','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.attachments','Attachments','Store event attachments','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.user_feedback','User Feedback','Collect end-user feedback','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.suspect_commits','Suspect Commits','Associate commits with issues','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.owner_rules','Ownership Rules','Automatic ownership assignment','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.issue_states','Issue Workflow','Resolved/ignored workflow','feature','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.event_sampling','Error Sampling','Independent error sampling','sampling','error_tracking','decimal','none','{"min":0,"max":1}'::jsonb,TRUE,FALSE),
('error_tracking.retention_days','Error Retention','Retention period for errors','quota','error_tracking','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('error_tracking.max_attachments_mb','Attachment Size','Maximum attachment size','quota','error_tracking','integer','hard_limit','{"unit":"MB"}'::jsonb,TRUE,FALSE),
('error_tracking.ai_root_cause','AI Root Cause','AI-assisted root cause analysis','ai','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.ai_summaries','AI Summaries','AI issue summaries','ai','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE),
('error_tracking.webhooks','Error Webhooks','Webhook notifications','integration','error_tracking','boolean','none','{}'::jsonb,TRUE,FALSE)
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
