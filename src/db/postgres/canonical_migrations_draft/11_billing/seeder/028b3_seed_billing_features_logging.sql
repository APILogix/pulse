-- =============================================================================
-- Module      : Billing
-- Migration   : 028b3_seed_billing_features_logging.sql
-- Description : Seed Logging feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('logging.enabled','Logging','Enable centralized logging','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.live_tail','Live Tail','Real-time log streaming','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.search','Log Search','Search indexed logs','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.saved_searches','Saved Searches','Save reusable log queries','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.parsing','Log Parsing','Structured log parsing','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.pipelines','Log Pipelines','Processing pipelines','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.masking','Sensitive Data Masking','Mask sensitive log data','privacy','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.archives','Log Archives','Archive logs to external storage','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.export','Log Export','Export logs','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.ingestion_filters','Ingestion Filters','Drop logs before ingestion','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.pattern_detection','Pattern Detection','Automatic log pattern detection','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.field_indexing','Field Indexing','Custom indexed fields','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.log_correlation','Trace Correlation','Correlate logs with traces','feature','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.anomaly_detection','Log Anomaly Detection','Detect anomalous logs','ai','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('logging.ai_summaries','AI Log Summaries','Summarize logs with AI','ai','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('quota.monthly_logs','Monthly Logs','Maximum billable logs','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.log_retention_days','Log Retention Days','Maximum log retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('quota.log_archives','Log Archives','Maximum archive destinations','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('integration.log_webhooks','Log Webhooks','Webhook notifications for log alerts','integration','logging','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.log_exports','External Log Export','Export logs to external systems','integration','logging','boolean','none','{}'::jsonb,TRUE,FALSE)
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