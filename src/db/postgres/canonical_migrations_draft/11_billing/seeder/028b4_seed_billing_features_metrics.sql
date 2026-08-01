-- =============================================================================
-- Module      : Billing
-- Migration   : 028b4_seed_billing_features_metrics.sql
-- Description : Seed Metrics feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('metrics.enabled','Metrics','Enable metrics platform','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.custom_metrics','Custom Metrics','Create custom metrics','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.counters','Counters','Counter metric support','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.gauges','Gauges','Gauge metric support','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.histograms','Histograms','Histogram metric support','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.summaries','Summaries','Summary metric support','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.percentiles','Percentiles','Percentile calculations','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.exemplars','Exemplars','Trace-linked exemplars','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.metric_math','Metric Math','Derived metric calculations','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.recording_rules','Recording Rules','Precomputed recording rules','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.downsampling','Downsampling','Automatic metric downsampling','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.dimensions','High Cardinality Dimensions','Support indexed dimensions','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.correlation','Trace Correlation','Correlate metrics with traces','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('metrics.live_stream','Live Metrics','Real-time metric stream','feature','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.metric_anomalies','AI Metric Anomalies','AI anomaly detection for metrics','ai','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.metric_forecasting','AI Forecasting','Forecast future metric trends','ai','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('quota.monthly_metrics','Monthly Metrics','Maximum metric points per billing cycle','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.metric_retention_days','Metric Retention Days','Maximum metric retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('integration.metrics_export','Metrics Export','Export metrics to external platforms','integration','metrics','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.prometheus_remote_write','Prometheus Remote Write','Prometheus remote write integration','integration','metrics','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,feature_name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
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
