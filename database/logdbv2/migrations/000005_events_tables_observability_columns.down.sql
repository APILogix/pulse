-- Migration: 000005_events_tables_observability_columns.down.sql
-- Database: LogDB v2

BEGIN;

DROP INDEX IF EXISTS idx_events_messages_pubid;
ALTER TABLE events_messages DROP COLUMN IF EXISTS public_id;

DROP INDEX IF EXISTS idx_events_replays_service;
DROP INDEX IF EXISTS idx_events_replays_tenant_env_time;
ALTER TABLE events_replays
  DROP COLUMN IF EXISTS events,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS status_code;

DROP INDEX IF EXISTS idx_events_profiles_tenant_env_time;
ALTER TABLE events_profiles
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS status_code,
  DROP COLUMN IF EXISTS tenant_id;

DROP INDEX IF EXISTS idx_events_cron_checkins_success;
DROP INDEX IF EXISTS idx_events_cron_checkins_tenant_env_time;
DROP INDEX IF EXISTS idx_events_cron_checkins_monitor_time;
ALTER TABLE events_cron_checkins
  DROP COLUMN IF EXISTS is_success,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS finished_at,
  DROP COLUMN IF EXISTS checkin_type,
  DROP COLUMN IF EXISTS schedule_type,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS status_code;

DROP INDEX IF EXISTS idx_events_metrics_category;
DROP INDEX IF EXISTS idx_events_metrics_name_time;
DROP INDEX IF EXISTS idx_events_metrics_tenant_env_time;
ALTER TABLE events_metrics
  DROP COLUMN IF EXISTS metric_namespace,
  DROP COLUMN IF EXISTS metric_description,
  DROP COLUMN IF EXISTS value,
  DROP COLUMN IF EXISTS count,
  DROP COLUMN IF EXISTS sum,
  DROP COLUMN IF EXISTS min,
  DROP COLUMN IF EXISTS max,
  DROP COLUMN IF EXISTS avg,
  DROP COLUMN IF EXISTS rate,
  DROP COLUMN IF EXISTS buckets,
  DROP COLUMN IF EXISTS p50,
  DROP COLUMN IF EXISTS p75,
  DROP COLUMN IF EXISTS p90,
  DROP COLUMN IF EXISTS p95,
  DROP COLUMN IF EXISTS p99,
  DROP COLUMN IF EXISTS metric_category,
  DROP COLUMN IF EXISTS aggregation_type,
  DROP COLUMN IF EXISTS temporality,
  DROP COLUMN IF EXISTS is_monotonic,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS http_method,
  DROP COLUMN IF EXISTS status_code,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS duration_ms,
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS severity;

DROP INDEX IF EXISTS idx_events_spans_status_time;
DROP INDEX IF EXISTS idx_events_spans_endpoint_time;
DROP INDEX IF EXISTS idx_events_spans_type_time;
DROP INDEX IF EXISTS idx_events_spans_parent_time;
DROP INDEX IF EXISTS idx_events_spans_trace_time;
ALTER TABLE events_spans
  DROP COLUMN IF EXISTS span_status,
  DROP COLUMN IF EXISTS is_root_span,
  DROP COLUMN IF EXISTS is_http_span,
  DROP COLUMN IF EXISTS is_db_span,
  DROP COLUMN IF EXISTS is_cache_span,
  DROP COLUMN IF EXISTS is_messaging_span,
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS exclusive_duration_ms,
  DROP COLUMN IF EXISTS depth,
  DROP COLUMN IF EXISTS severity,
  DROP COLUMN IF EXISTS http_route,
  DROP COLUMN IF EXISTS http_target,
  DROP COLUMN IF EXISTS http_scheme,
  DROP COLUMN IF EXISTS http_flavor,
  DROP COLUMN IF EXISTS http_status_text,
  DROP COLUMN IF EXISTS http_response_size,
  DROP COLUMN IF EXISTS http_user_agent,
  DROP COLUMN IF EXISTS client_ip_hash,
  DROP COLUMN IF EXISTS net_transport,
  DROP COLUMN IF EXISTS net_host_name,
  DROP COLUMN IF EXISTS net_host_ip,
  DROP COLUMN IF EXISTS net_host_port,
  DROP COLUMN IF EXISTS net_peer_ip,
  DROP COLUMN IF EXISTS net_peer_port,
  DROP COLUMN IF EXISTS messaging_system,
  DROP COLUMN IF EXISTS messaging_destination,
  DROP COLUMN IF EXISTS messaging_operation,
  DROP COLUMN IF EXISTS events,
  DROP COLUMN IF EXISTS links,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version;

DROP INDEX IF EXISTS idx_events_logs_status_code;
DROP INDEX IF EXISTS idx_events_logs_logger_name;
DROP INDEX IF EXISTS idx_events_logs_category;
DROP INDEX IF EXISTS idx_events_logs_endpoint;
DROP INDEX IF EXISTS idx_events_logs_service;
ALTER TABLE events_logs
  DROP COLUMN IF EXISTS args,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS logger_name,
  DROP COLUMN IF EXISTS log_source,
  DROP COLUMN IF EXISTS log_category,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS http_method,
  DROP COLUMN IF EXISTS status_code,
  DROP COLUMN IF EXISTS duration_ms,
  DROP COLUMN IF EXISTS service,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS user_ip,
  DROP COLUMN IF EXISTS severity;

DROP INDEX IF EXISTS idx_events_errors_fingerprint_time;
DROP INDEX IF EXISTS idx_events_errors_tenant_env_time;
ALTER TABLE events_errors
  DROP COLUMN IF EXISTS fingerprint_version,
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS mechanism,
  DROP COLUMN IF EXISTS server_name,
  DROP COLUMN IF EXISTS application_name,
  DROP COLUMN IF EXISTS application_version,
  DROP COLUMN IF EXISTS stack_frames,
  DROP COLUMN IF EXISTS breadcrumbs,
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS status_text;

COMMIT;
