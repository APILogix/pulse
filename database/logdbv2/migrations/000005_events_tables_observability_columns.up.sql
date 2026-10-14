-- Migration: 000005_events_tables_observability_columns.up.sql
-- Database: LogDB v2
-- Description: Add missing ingestion and explorer fields with indexes across canonical events tables

BEGIN;

-- 1. events_errors: Ingestion & Explorer fields
ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS fingerprint_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS mechanism TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS stack_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS breadcrumbs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS status_text TEXT;

-- Backfill message from error_message if existing
UPDATE events_errors
  SET message = error_message
  WHERE message IS NULL AND error_message IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_tenant_env_time
  ON events_errors (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint_time
  ON events_errors (organization_id, project_id, fingerprint, occurred_at DESC)
  WHERE fingerprint IS NOT NULL;

-- 2. events_logs: Ingestion & Explorer fields
ALTER TABLE events_logs
  ADD COLUMN IF NOT EXISTS args JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS logger_name TEXT,
  ADD COLUMN IF NOT EXISTS log_source TEXT,
  ADD COLUMN IF NOT EXISTS log_category TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS status_code INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS user_ip INET,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info';

-- Backfill logger_name from logger if existing
UPDATE events_logs
  SET logger_name = logger
  WHERE logger_name IS NULL AND logger IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_service
  ON events_logs (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint
  ON events_logs (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_category
  ON events_logs (organization_id, project_id, log_category, occurred_at DESC)
  WHERE log_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger_name
  ON events_logs (organization_id, project_id, logger_name, occurred_at DESC)
  WHERE logger_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_status_code
  ON events_logs (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

-- 3. events_spans: Ingestion & Explorer fields
ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS span_status TEXT,
  ADD COLUMN IF NOT EXISTS is_root_span BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_http_span BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_db_span BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_cache_span BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_messaging_span BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exclusive_duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS depth INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS http_route TEXT,
  ADD COLUMN IF NOT EXISTS http_target TEXT,
  ADD COLUMN IF NOT EXISTS http_scheme TEXT,
  ADD COLUMN IF NOT EXISTS http_flavor TEXT,
  ADD COLUMN IF NOT EXISTS http_status_text TEXT,
  ADD COLUMN IF NOT EXISTS http_response_size BIGINT,
  ADD COLUMN IF NOT EXISTS http_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS net_transport TEXT,
  ADD COLUMN IF NOT EXISTS net_host_name TEXT,
  ADD COLUMN IF NOT EXISTS net_host_ip TEXT,
  ADD COLUMN IF NOT EXISTS net_host_port INTEGER,
  ADD COLUMN IF NOT EXISTS net_peer_ip TEXT,
  ADD COLUMN IF NOT EXISTS net_peer_port INTEGER,
  ADD COLUMN IF NOT EXISTS messaging_system TEXT,
  ADD COLUMN IF NOT EXISTS messaging_destination TEXT,
  ADD COLUMN IF NOT EXISTS messaging_operation TEXT,
  ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT;

CREATE INDEX IF NOT EXISTS idx_events_spans_trace_time
  ON events_spans (organization_id, trace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_parent_time
  ON events_spans (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_type_time
  ON events_spans (organization_id, project_id, span_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_status_time
  ON events_spans (organization_id, project_id, span_status, occurred_at DESC)
  WHERE span_status IS NOT NULL;

-- 4. events_metrics: Ingestion & Explorer fields
ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS metric_namespace TEXT,
  ADD COLUMN IF NOT EXISTS metric_description TEXT,
  ADD COLUMN IF NOT EXISTS value NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS count BIGINT,
  ADD COLUMN IF NOT EXISTS sum NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS min NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS max NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS avg NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS rate NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS buckets JSONB,
  ADD COLUMN IF NOT EXISTS p50 NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS p75 NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS p90 NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS p95 NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS p99 NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS metric_category TEXT,
  ADD COLUMN IF NOT EXISTS aggregation_type TEXT,
  ADD COLUMN IF NOT EXISTS temporality TEXT,
  ADD COLUMN IF NOT EXISTS is_monotonic BOOLEAN,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS status_code INTEGER,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info';

-- Backfill value/count/sum/min/max from metric_* if populated
UPDATE events_metrics SET
  value = COALESCE(value, metric_value),
  count = COALESCE(count, metric_count),
  sum = COALESCE(sum, metric_sum),
  min = COALESCE(min, metric_min),
  max = COALESCE(max, metric_max)
WHERE value IS NULL AND metric_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_category
  ON events_metrics (organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

-- 5. events_cron_checkins: Ingestion & Explorer fields
ALTER TABLE events_cron_checkins
  ADD COLUMN IF NOT EXISTS is_success BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_type TEXT,
  ADD COLUMN IF NOT EXISTS schedule_type TEXT,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS status_code INTEGER;

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor_time
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_success
  ON events_cron_checkins (organization_id, project_id, is_success, occurred_at DESC);

-- 6. events_profiles: Ingestion & Explorer fields
ALTER TABLE events_profiles
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS status_code INTEGER,
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_profiles_tenant_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

-- 7. events_replays: Ingestion & Explorer fields
ALTER TABLE events_replays
  ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS status_code INTEGER;

CREATE INDEX IF NOT EXISTS idx_events_replays_tenant_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_service
  ON events_replays (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

-- 8. events_messages: Consistency public_id
ALTER TABLE events_messages
  ADD COLUMN IF NOT EXISTS public_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_messages_pubid
  ON events_messages (organization_id, project_id, public_id)
  WHERE public_id IS NOT NULL;

COMMIT;
