-- =============================================================================
-- Module      : Billing
-- Migration   : 028b2_seed_billing_features_tracing.sql
-- Description : Seed Distributed Tracing feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('tracing.enabled','Distributed Tracing','Enable distributed tracing','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.opentelemetry','OpenTelemetry Support','Native OpenTelemetry ingestion','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.service_map','Service Map','Interactive service dependency map','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.trace_search','Trace Search','Search and filter traces','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.span_search','Span Search','Search individual spans','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.span_links','Span Links','Support span links','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.span_events','Span Events','Capture span events','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.span_attributes','Span Attributes','Index custom span attributes','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.baggage','Baggage Propagation','Distributed baggage propagation','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.context_propagation','Context Propagation','Cross-service context propagation','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.trace_analytics','Trace Analytics','Aggregate trace analytics','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.flame_graphs','Flame Graphs','Trace flame graph visualization','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.critical_path','Critical Path','Critical path analysis','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.service_dependencies','Service Dependencies','Dependency topology analysis','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.trace_compare','Trace Comparison','Compare two traces','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('tracing.live_traces','Live Traces','Real-time trace stream','feature','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('sampling.trace_dynamic','Dynamic Trace Sampling','Adaptive trace sampling','sampling','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('quota.trace_retention_days','Trace Retention Days','Maximum trace retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('quota.monthly_traces','Monthly Traces','Maximum traces per billing cycle','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('ai.trace_analysis','AI Trace Analysis','AI-assisted trace investigation','ai','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.trace_anomalies','AI Trace Anomaly Detection','Detect anomalous traces using AI','ai','tracing','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.trace_webhooks','Trace Webhooks','Webhook notifications for traces','integration','tracing','boolean','none','{}'::jsonb,TRUE,FALSE)
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
