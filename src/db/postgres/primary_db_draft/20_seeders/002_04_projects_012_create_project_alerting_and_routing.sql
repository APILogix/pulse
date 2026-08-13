-- Source: canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
INSERT INTO project_notification_preferences(organization_id,project_id,category)
SELECT org_id,id,'all' FROM projects ON CONFLICT DO NOTHING;

-- Source: canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql
INSERT INTO project_alert_thresholds(organization_id,project_id,threshold_key,metric_name,metric_source,category,severity,comparison_operator,threshold_value,threshold_unit,evaluation_window_minutes,cooldown_minutes,consecutive_breaches)
SELECT p.org_id,p.id,t.threshold_key,t.metric_name,'project_usage','performance',t.severity,'>=',t.threshold_value,t.threshold_unit,5,15,1
FROM projects p CROSS JOIN (VALUES
 ('latency_p50','latency_ms_p50','warning',500::numeric,'ms'),
 ('latency_p75','latency_ms_p75','warning',750::numeric,'ms'),
 ('latency_p90','latency_ms_p90','warning',1000::numeric,'ms'),
 ('latency_p95','latency_ms_p95','error',1500::numeric,'ms'),
 ('latency_p99','latency_ms_p99','critical',2500::numeric,'ms'),
 ('error_rate','error_rate','error',5::numeric,'percent'),
 ('apdex','apdex','warning',0.85::numeric,'score'),
 ('event_volume_spike','total_events','warning',200::numeric,'percent'),
 ('event_volume_drop','total_events','warning',50::numeric,'percent'),
 ('failed_notification_rate','failed_notifications','error',10::numeric,'percent'),
 ('ingestion_error_rate','ingestion_errors','error',5::numeric,'percent'),
 ('rate_limit_usage','rate_limit_usage','warning',80::numeric,'percent'),
 ('ai_usage_cost','ai_cost','warning',100::numeric,'currency')
) t(threshold_key,metric_name,severity,threshold_value,threshold_unit)
WHERE NOT EXISTS(SELECT 1 FROM project_alert_thresholds x WHERE x.project_id=p.id AND x.environment_id IS NULL AND x.threshold_key=t.threshold_key AND x.deleted_at IS NULL);
