-- =============================================================================
-- Module      : Billing
-- Migration   : 028b7_seed_billing_features_uptime_cron.sql
-- Description : Seed Uptime Monitoring & Cron Monitoring feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('uptime.enabled','Uptime Monitoring','Enable uptime monitoring','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.http_checks','HTTP Checks','HTTP/HTTPS synthetic checks','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.tcp_checks','TCP Checks','TCP endpoint monitoring','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.ping_checks','Ping Checks','ICMP ping monitoring','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.ssl_monitoring','SSL Monitoring','SSL certificate monitoring','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.dns_monitoring','DNS Monitoring','DNS resolution monitoring','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.multi_region','Multi-region Checks','Execute checks from multiple regions','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.public_status_page','Public Status Page','Expose public service status','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('uptime.private_status_page','Private Status Page','Internal status dashboards','feature','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),

('cron.enabled','Cron Monitoring','Monitor scheduled jobs','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),
('cron.heartbeats','Heartbeats','Heartbeat check-ins','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),
('cron.missed_runs','Missed Run Detection','Detect missed cron executions','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),
('cron.late_runs','Late Run Detection','Detect delayed cron executions','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),
('cron.execution_history','Execution History','Store cron execution history','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),
('cron.failure_analysis','Failure Analysis','Analyze cron failures','feature','cron','boolean','none','{}'::jsonb,TRUE,FALSE),

('ai.uptime_anomalies','AI Uptime Anomalies','AI outage and anomaly detection','ai','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.cron_failure_prediction','AI Cron Prediction','Predict cron failures','ai','cron','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.monitors','Monitors','Maximum monitors','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.status_pages','Status Pages','Maximum status pages','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.cron_monitors','Cron Monitors','Maximum cron monitors','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.cron_checkins','Monthly Cron Check-ins','Maximum cron check-ins','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('integration.pagerduty','PagerDuty Integration','Notify PagerDuty','integration','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.opsgenie','Opsgenie Integration','Notify Opsgenie','integration','uptime','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.statuspage','Status Page Integration','Publish incidents to status pages','integration','uptime','boolean','none','{}'::jsonb,TRUE,FALSE)
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
