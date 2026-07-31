=

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('ai.enabled','AI Platform','Enable AI-powered features','feature','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.root_cause_analysis','Root Cause Analysis','AI-assisted root cause analysis','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.anomaly_detection','Anomaly Detection','Detect anomalies across telemetry','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.intelligent_alerting','Intelligent Alerting','Reduce alert noise with AI','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.summaries','AI Summaries','Generate summaries for incidents and telemetry','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.forecasting','Forecasting','Predict future trends','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.recommendations','Recommendations','Recommend optimizations','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.incident_copilot','Incident Copilot','Interactive incident assistant','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.query_assistant','Query Assistant','Natural language query generation','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.release_insights','Release Insights','Analyze release impact','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.change_detection','Change Detection','Correlate deployments with regressions','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.service_health_score','Service Health Score','AI-generated health scoring','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.automation','AI Automation','Execute AI-assisted remediation workflows','ai','ai','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.ai_credits','AI Credits','Monthly AI credit allocation','quota','quota','integer','overage','{"unit":"credits"}'::jsonb,TRUE,FALSE),
('quota.ai_requests','AI Requests','Maximum AI requests per month','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('integrations.openai','OpenAI Provider','Use OpenAI models','integration','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.anthropic','Anthropic Provider','Use Anthropic models','integration','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.google_ai','Google AI Provider','Use Google AI models','integration','ai','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.custom_llm','Custom LLM','Connect custom AI providers','integration','ai','boolean','none','{}'::jsonb,TRUE,FALSE)
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