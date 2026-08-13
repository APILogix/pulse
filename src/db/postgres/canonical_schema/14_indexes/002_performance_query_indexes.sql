-- Performance & High-Velocity Temporal Query Indexes
-- File: 14_indexes/002_performance_query_indexes.sql

CREATE INDEX IF NOT EXISTS idx_events_req_occurred_at ON events_requests(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_req_org_occurred ON events_requests(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_req_proj_occurred ON events_requests(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_err_group_id ON events_errors(group_id);
CREATE INDEX IF NOT EXISTS idx_events_err_org_occurred ON events_errors(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_err_proj_occurred ON events_errors(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_occurred ON events_logs(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_proj_occurred ON events_logs(project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_status ON alert_incidents(status, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notifications_incident ON alert_notifications(incident_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_status ON telemetry_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_requests_org_id ON ai_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_id ON automation_runs(workflow_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_counters_lookup ON usage_daily_counters(organization_id, metric_key, date_bucket);
