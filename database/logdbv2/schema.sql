-- Clean PostgreSQL LogDB baseline.
-- Generated from modular database/logdbv2/schema domain sources with proper indexing and partitioning.

-- ============================================================
-- Source: 00_extensions/001_extensions.sql
-- ============================================================

-- Extensions required by LogDB
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Optional native C extension for RFC 9562 UUIDv7
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present on host OS
END $$;

-- ============================================================
-- Source: 01_types/001_sequences.sql
-- ============================================================

-- Canonical Public ID sequences for LogDB entities
CREATE SEQUENCE IF NOT EXISTS seq_pubid_requests START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_errors START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_traces START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_spans START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_logs START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_metrics START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_messages START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_replays START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_profiles START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_cron_checkins START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_sessions START WITH 1 INCREMENT BY 1;

-- ============================================================
-- Source: 01_types/002_enums_and_domains.sql
-- ============================================================

-- LogDB enums and shared domain types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_job_state') THEN
    CREATE TYPE logdb_job_state AS ENUM ('pending', 'active', 'completed', 'failed', 'dead_letter', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_severity') THEN
    CREATE TYPE logdb_severity AS ENUM ('debug', 'info', 'warning', 'error', 'critical', 'fatal');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_delivery_status') THEN
    CREATE TYPE logdb_delivery_status AS ENUM ('pending', 'delivered', 'failed', 'retrying', 'discarded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_ai_status') THEN
    CREATE TYPE logdb_ai_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'in_app','email','slack','discord','teams','pagerduty','webhook','sms'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_kind') THEN
    CREATE TYPE alert_event_kind AS ENUM (
      'fired','recovered','duplicate','suppressed','silenced'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_state') THEN
    CREATE TYPE alert_state AS ENUM (
      'pending','firing','acknowledged','resolved','suppressed','silenced','expired','error'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_job_status') THEN
    CREATE TYPE notification_job_status AS ENUM (
      'pending','queued','sent','failed','suppressed','cancelled','expired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_usage_kind') THEN
    CREATE TYPE alert_usage_kind AS ENUM (
      'alert_generated','alert_suppressed','alert_delivered','alert_failed',
      'connector_send','email_sent','slack_message','sms_sent','webhook_call',
      'discord_message','teams_message','pagerduty_event','delivery_retry'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_delivery_status_v2') THEN
    CREATE TYPE connector_delivery_status_v2 AS ENUM (
      'pending','queued','sent','retrying','failed','suppressed','cancelled'
    );
  END IF;
END $$;

-- ============================================================
-- Source: 02_schema_notes/001_create_logdb_schema_notes.sql
-- ============================================================

-- Schema boundary and operational policy registry
CREATE TABLE IF NOT EXISTS logdb_schema_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('database_boundary', 'Log DB tables intentionally store primary-database identifiers as UUID/TEXT values without REFERENCES constraints. Application services validate ownership and authorization.'),
  ('partitioning_policy', 'Continuously growing event, usage, runtime, audit, AI, automation, and retention tables are range-partitioned by bucket, occurred_at, created_at, or started_at to support retention pruning and dashboard time filters.'),
  ('indexing_policy', 'BRIN indexes support time-window scans on append-heavy tables; btree indexes target tenant-scoped dashboards and worker claims; GIN indexes are limited to JSONB payloads used by search or filtering.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

-- ============================================================
-- Source: 03_lookup/001_create_organization_lookup.sql
-- ============================================================

-- Organization lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS organization_lookup (
  organization_id UUID PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  plan_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 03_lookup/002_create_project_lookup.sql
-- ============================================================

-- Project lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS project_lookup (
  project_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT,
  slug TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_project_lookup_org ON project_lookup(organization_id);

-- ============================================================
-- Source: 03_lookup/003_create_environment_lookup.sql
-- ============================================================

-- Environment lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS environment_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  name TEXT,
  slug TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_environment_lookup_project ON environment_lookup(project_id);
CREATE INDEX IF NOT EXISTS idx_environment_lookup_org ON environment_lookup(organization_id);

-- ============================================================
-- Source: 03_lookup/004_create_release_lookup.sql
-- ============================================================

-- Release lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS release_lookup (
  release_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  release TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, release)
);

CREATE INDEX IF NOT EXISTS idx_release_lookup_org_project ON release_lookup(organization_id, project_id);

-- ============================================================
-- Source: 03_lookup/005_create_api_key_lookup.sql
-- ============================================================

-- API Key lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS api_key_lookup (
  api_key_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment_id UUID,
  key_prefix TEXT,
  name TEXT,
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_lookup_org ON api_key_lookup(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_key_lookup_project_env ON api_key_lookup(project_id, environment_id);

-- ============================================================
-- Source: 03_lookup/006_create_environment_sdk_config_lookup.sql
-- ============================================================

-- Environment SDK config lookup table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS environment_sdk_config_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  revision_number INTEGER NOT NULL,
  config_hash TEXT,
  compiled_snapshot JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN environment_sdk_config_lookup.compiled_snapshot IS
  'Mirrors the full SDK schema-v1 remote config document, including limits.persistenceGovernance for SDK-side persistence budget control.';

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_project
  ON environment_sdk_config_lookup(project_id, environment_id);

CREATE INDEX IF NOT EXISTS idx_environment_sdk_config_lookup_org
  ON environment_sdk_config_lookup(organization_id, synced_at DESC);

-- ============================================================
-- Source: 03_lookup/007_create_telemetry_dimensions.sql
-- ============================================================

-- Telemetry dimensions lookup reference tables
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'telemetry_dimensions_service',
    'telemetry_dimensions_endpoint',
    'telemetry_dimensions_release',
    'telemetry_dimensions_browser',
    'telemetry_dimensions_host',
    'telemetry_dimensions_os',
    'telemetry_dimensions_runtime',
    'telemetry_dimensions_region'
  ] LOOP
    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        project_id UUID,
        dimension_key TEXT NOT NULL,
        display_name TEXT,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, project_id, dimension_key)
      )
    $sql$, table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, last_seen_at DESC)', 'idx_' || table_name || '_last_seen', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (attributes)', 'idx_' || table_name || '_attrs_gin', table_name);
  END LOOP;
END $$;

-- ============================================================
-- Source: 04_ingestion/001_create_ingestion_queue_snapshot.sql
-- ============================================================

-- Ingestion queue depth and snapshot statistics (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pending_count BIGINT NOT NULL DEFAULT 0,
  active_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  oldest_pending_at TIMESTAMPTZ,
  worker_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot_default PARTITION OF ingestion_queue_snapshot DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_queue_time ON ingestion_queue_snapshot(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_brin ON ingestion_queue_snapshot USING BRIN (captured_at);

-- ============================================================
-- Source: 04_ingestion/002_create_ingestion_metrics.sql
-- ============================================================

-- Ingestion subsystem operational metrics (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(18,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_metrics_default PARTITION OF ingestion_metrics DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time ON ingestion_metrics(metric_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_tenant_time ON ingestion_metrics(organization_id, project_id, metric_name, captured_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_dimensions_gin ON ingestion_metrics USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_brin ON ingestion_metrics USING BRIN (captured_at);

-- ============================================================
-- Source: 04_ingestion/003_create_worker_performance.sql
-- ============================================================

-- Ingestion worker performance and resource telemetry (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS worker_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  memory_mb NUMERIC(12,3),
  cpu_percent NUMERIC(6,3),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS worker_performance_default PARTITION OF worker_performance DEFAULT;

CREATE INDEX IF NOT EXISTS idx_worker_performance_worker_time ON worker_performance(worker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_performance_brin ON worker_performance USING BRIN (captured_at);

-- ============================================================
-- Source: 04_ingestion/004_create_backpressure_gauge.sql
-- ============================================================

-- Ingestion queue backpressure telemetry (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pressure_score NUMERIC(8,4) NOT NULL CHECK (pressure_score >= 0),
  reason TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS backpressure_gauge_default PARTITION OF backpressure_gauge DEFAULT;

CREATE INDEX IF NOT EXISTS idx_backpressure_queue_time ON backpressure_gauge(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_backpressure_brin ON backpressure_gauge USING BRIN (captured_at);

-- ============================================================
-- Source: 04_ingestion/005_create_ingestion_failures.sql
-- ============================================================

-- Ingestion rejection and parsing error DLQ (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_id UUID,
  event_type TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT ingestion_failures_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ingestion_failures_default PARTITION OF ingestion_failures DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_tenant_env_time
  ON ingestion_failures(organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time ON ingestion_failures(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin ON ingestion_failures USING BRIN (occurred_at);

-- ============================================================
-- Source: 05_observability/001_create_events_requests.sql
-- ============================================================

-- Canonical request telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  environment TEXT NOT NULL,
  endpoint TEXT,
  name TEXT,
  public_id TEXT,
  method TEXT,
  route TEXT,
  url TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(12,3),
  latency_ms NUMERIC(12,3),
  is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms, latency_ms) > 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  service TEXT,
  framework TEXT,
  server_name TEXT,
  severity TEXT DEFAULT 'info',
  body_size BIGINT,
  response_size BIGINT,
  request_size_bytes BIGINT,
  response_size_bytes BIGINT,
  span_count INTEGER DEFAULT 0,
  root_span_status TEXT,
  is_partial BOOLEAN DEFAULT FALSE,
  client_ip_hash TEXT,
  user_agent TEXT,
  referer TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  geo_region TEXT,
  geo_asn INTEGER,
  browser_family TEXT,
  browser_version_major TEXT,
  os_name TEXT,
  os_version_major TEXT,
  device_type TEXT,
  is_bot BOOLEAN DEFAULT FALSE,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  ip_address INET,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_requests_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_requests_default PARTITION OF events_requests DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_requests_event_unique
  ON events_requests (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_time
  ON events_requests (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_tenant_env_time
  ON events_requests (organization_id, project_id, environment, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_requests_pubid
  ON events_requests (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_trace_time
  ON events_requests (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_org_request_time
  ON events_requests (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_geo_time
  ON events_requests (organization_id, project_id, geo_country_code, occurred_at DESC)
  WHERE geo_country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_release_time
  ON events_requests (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_session_time
  ON events_requests (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_sdk_time
  ON events_requests (organization_id, project_id, sdk_name, sdk_version, occurred_at DESC)
  WHERE sdk_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_occurred_brin
  ON events_requests USING BRIN (occurred_at) WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_events_requests_watermark
  ON events_requests (organization_id, project_id, environment, ingested_at);

CREATE INDEX IF NOT EXISTS idx_events_requests_error_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_error = TRUE;

CREATE INDEX IF NOT EXISTS idx_events_requests_slow_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_slow = TRUE;

-- ============================================================
-- Source: 05_observability/002_create_events_errors.sql
-- ============================================================

-- Canonical error telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_errors (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  api_key_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  fingerprint TEXT,
  fingerprint_version INTEGER DEFAULT 1,
  error_group_id UUID,
  error_name TEXT NOT NULL,
  error_message TEXT,
  message TEXT,
  mechanism TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  stack_trace TEXT,
  stack_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  breadcrumbs JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_id TEXT,
  severity TEXT NOT NULL DEFAULT 'error',
  status_code INTEGER,
  status_text TEXT,
  handled BOOLEAN NOT NULL DEFAULT false,
  service TEXT,
  route TEXT,
  method TEXT,
  url TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  ip_address INET,
  geo_country_code CHAR(2),
  geo_city TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_errors_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_errors_default PARTITION OF events_errors DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_errors_event_unique
  ON events_errors (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_project_time
  ON events_errors (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_errors_org_env_time
  ON events_errors (organization_id, project_id, environment, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_errors_pubid
  ON events_errors (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_errors_group_time_v2
  ON events_errors (organization_id, project_id, error_group_id, occurred_at DESC)
  WHERE error_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint
  ON events_errors (organization_id, project_id, fingerprint, occurred_at DESC)
  WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_trace
  ON events_errors (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_span
  ON events_errors (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_parent_span
  ON events_errors (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_request
  ON events_errors (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_session
  ON events_errors (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_user
  ON events_errors (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_service
  ON events_errors (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_route
  ON events_errors (organization_id, project_id, route, occurred_at DESC)
  WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_occurred_brin
  ON events_errors USING BRIN (occurred_at) WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_events_errors_watermark
  ON events_errors (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/003_create_events_logs.sql
-- ============================================================

-- Canonical log telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_logs (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  level TEXT,
  severity TEXT DEFAULT 'info',
  logger TEXT,
  logger_name TEXT,
  name TEXT,
  log_source TEXT,
  log_category TEXT,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  user_ip INET,
  message TEXT,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  args JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_logs_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_logs_default PARTITION OF events_logs DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique
  ON events_logs (
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at
  );

CREATE INDEX IF NOT EXISTS idx_events_logs_org_project_time
  ON events_logs (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_env_time
  ON events_logs (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_time
  ON events_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_env_direct_time
  ON events_logs (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_pubid
  ON events_logs (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_logs_trace
  ON events_logs (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_span
  ON events_logs (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_parent_span
  ON events_logs (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_request
  ON events_logs (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_session
  ON events_logs (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_user
  ON events_logs (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_tenant
  ON events_logs (organization_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_level
  ON events_logs (organization_id, project_id, level, occurred_at DESC)
  WHERE level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger
  ON events_logs (organization_id, project_id, logger, occurred_at DESC)
  WHERE logger IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_logger_name
  ON events_logs (organization_id, project_id, logger_name, occurred_at DESC)
  WHERE logger_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_service
  ON events_logs (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_endpoint
  ON events_logs (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_category
  ON events_logs (organization_id, project_id, log_category, occurred_at DESC)
  WHERE log_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_status_code
  ON events_logs (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_release_time
  ON events_logs (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_logs_occurred_brin
  ON events_logs USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_logs_watermark
  ON events_logs (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/004_create_events_metrics.sql
-- ============================================================

-- Canonical metric telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_metrics (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  metric_name TEXT,
  metric_type TEXT,
  metric_unit TEXT,
  metric_namespace TEXT,
  metric_description TEXT,
  metric_value NUMERIC(20,6),
  metric_count BIGINT,
  metric_sum NUMERIC(20,6),
  metric_min NUMERIC(20,6),
  metric_max NUMERIC(20,6),
  value NUMERIC(20,6),
  count BIGINT,
  sum NUMERIC(20,6),
  min NUMERIC(20,6),
  max NUMERIC(20,6),
  avg NUMERIC(20,6),
  rate NUMERIC(20,6),
  buckets JSONB,
  p50 NUMERIC(20,6),
  p75 NUMERIC(20,6),
  p90 NUMERIC(20,6),
  p95 NUMERIC(20,6),
  p99 NUMERIC(20,6),
  metric_category TEXT,
  aggregation_type TEXT,
  temporality TEXT,
  is_monotonic BOOLEAN,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  name TEXT,
  duration_ms NUMERIC(14,3),
  message TEXT,
  severity TEXT DEFAULT 'info',
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_metrics_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_metrics_default PARTITION OF events_metrics DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_metrics_event_unique
  ON events_metrics (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_project_time
  ON events_metrics (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_env_time
  ON events_metrics (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_time
  ON events_metrics (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_env_direct_time
  ON events_metrics (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid
  ON events_metrics (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics (organization_id, project_id, metric_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_category
  ON events_metrics (organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_type
  ON events_metrics (organization_id, project_id, metric_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_metrics_trace
  ON events_metrics (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_span
  ON events_metrics (organization_id, span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_parent_span
  ON events_metrics (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_request
  ON events_metrics (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_session
  ON events_metrics (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_user
  ON events_metrics (organization_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant
  ON events_metrics (organization_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_release_time
  ON events_metrics (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_occurred_brin
  ON events_metrics USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_metrics_watermark
  ON events_metrics (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/005_create_events_spans.sql
-- ============================================================

-- Canonical span telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_spans (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  span_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  request_id TEXT,
  span_kind TEXT,
  span_type TEXT,
  span_status TEXT,
  is_root_span BOOLEAN DEFAULT FALSE,
  is_http_span BOOLEAN DEFAULT FALSE,
  is_db_span BOOLEAN DEFAULT FALSE,
  is_cache_span BOOLEAN DEFAULT FALSE,
  is_messaging_span BOOLEAN DEFAULT FALSE,
  name TEXT,
  message TEXT,
  endpoint TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_ms NUMERIC(12,3),
  exclusive_duration_ms NUMERIC(14,3),
  depth INTEGER DEFAULT 0,
  severity TEXT DEFAULT 'info',
  status_code INTEGER,
  status_message TEXT,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  db_system TEXT,
  db_name TEXT,
  db_statement TEXT,
  db_operation TEXT,
  db_collection TEXT,
  http_method TEXT,
  http_route TEXT,
  http_url TEXT,
  http_target TEXT,
  http_status_code INTEGER,
  http_status_text TEXT,
  http_response_size BIGINT,
  http_user_agent TEXT,
  http_host TEXT,
  http_scheme TEXT,
  http_flavor TEXT,
  client_ip_hash TEXT,
  net_transport TEXT,
  net_host_name TEXT,
  net_host_ip TEXT,
  net_host_port INTEGER,
  net_peer_ip TEXT,
  net_peer_port INTEGER,
  messaging_system TEXT,
  messaging_destination TEXT,
  messaging_operation TEXT,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_spans_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_spans_default PARTITION OF events_spans DEFAULT;

-- Hot-Path High Performance Indexes
CREATE INDEX IF NOT EXISTS idx_events_spans_org_trace_time_asc
  ON events_spans (organization_id, trace_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_span_id
  ON events_spans (organization_id, span_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_slow_db
  ON events_spans (organization_id, project_id, environment, db_system, duration_ms DESC)
  WHERE db_system IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_db_collection
  ON events_spans (organization_id, project_id, environment, db_collection, occurred_at DESC)
  WHERE db_collection IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_org_session_time
  ON events_spans (organization_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

-- Standard Query Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_spans_event_unique
  ON events_spans (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_project_time
  ON events_spans (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_env_time
  ON events_spans (organization_id, project_id, environment, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_request_time
  ON events_spans (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_pubid
  ON events_spans (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_parent_span
  ON events_spans (organization_id, parent_span_id, occurred_at DESC)
  WHERE parent_span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_service
  ON events_spans (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_occurred_brin
  ON events_spans USING BRIN (occurred_at) WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS idx_events_spans_watermark
  ON events_spans (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/006_create_events_traces.sql
-- ============================================================

-- Canonical trace telemetry (one row per trace, root span denormalized).
-- Range-partitioned by occurred_at for retention pruning and trace lookup.
CREATE TABLE IF NOT EXISTS events_traces (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id UUID NOT NULL,
  public_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  request_id TEXT,

  -- Root span identity
  root_span_name TEXT,
  root_span_id TEXT,
  span_kind TEXT,
  root_span_status TEXT,
  endpoint TEXT,
  http_method TEXT,
  status_code INTEGER,
  is_partial BOOLEAN,

  -- Trace metrics
  duration_ms NUMERIC(14,3),
  total_duration_ms NUMERIC(14,3),
  response_size BIGINT,
  span_count INTEGER,
  spans_tree JSONB,

  -- Client context
  user_agent TEXT,
  client_ip_hash TEXT,

  -- SDK / service context
  service TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,
  severity logdb_severity,
  message TEXT,
  name TEXT,

  -- Flexible storage
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,

  -- Timekeeping
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_traces_default PARTITION OF events_traces DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_traces_event_unique
  ON events_traces (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_traces_tenant_time
  ON events_traces (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_tenant_env_time
  ON events_traces (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_org_proj_time
  ON events_traces (organization_id, project_id, occurred_at DESC);

-- Trace lookups
CREATE INDEX IF NOT EXISTS idx_events_traces_trace_time
  ON events_traces (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_trace_id_hash
  ON events_traces (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_traces_request_time
  ON events_traces (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

-- Service / endpoint / status filters
CREATE INDEX IF NOT EXISTS idx_events_traces_service
  ON events_traces (service, occurred_at DESC)
  WHERE service IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_endpoint_time
  ON events_traces (organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_status_time
  ON events_traces (organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_traces_occurred_brin
  ON events_traces USING BRIN (occurred_at);

-- ============================================================
-- Source: 05_observability/007_create_events_messages.sql
-- ============================================================

-- Canonical message telemetry (breadcrumb / audit / messaging events).
-- Range-partitioned by occurred_at for retention pruning.
CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,

  -- Identity & correlation
  event_id UUID NOT NULL,
  public_id TEXT,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,

  -- Message content
  name TEXT,
  message TEXT,
  severity logdb_severity,
  status_code INTEGER,
  duration_ms NUMERIC(14,3),
  logger_name TEXT,
  message_category TEXT,
  message_source TEXT,
  user_ip INET,

  -- Context
  tags JSONB,
  contexts JSONB,
  breadcrumbs JSONB,
  service TEXT,
  endpoint TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  application_name TEXT,
  application_version TEXT,
  server_name TEXT,

  -- Flexible storage
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,

  -- Timekeeping
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_messages_default PARTITION OF events_messages DEFAULT;

-- Unique event guard
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_messages_event_unique
  ON events_messages (organization_id, event_id, occurred_at);

-- Tenant / time filters
CREATE INDEX IF NOT EXISTS idx_events_messages_tenant_time
  ON events_messages (organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_messages_tenant_env_time
  ON events_messages (organization_id, project_id, environment, occurred_at DESC);

-- Correlation lookups
CREATE INDEX IF NOT EXISTS idx_events_messages_trace_time
  ON events_messages (trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_span_time
  ON events_messages (span_id, occurred_at DESC)
  WHERE span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_session_time
  ON events_messages (organization_id, project_id, session_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_user_time
  ON events_messages (organization_id, project_id, user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_messages_request_time
  ON events_messages (organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

-- Public ID
CREATE INDEX IF NOT EXISTS idx_events_messages_pubid
  ON events_messages (organization_id, project_id, public_id)
  WHERE public_id IS NOT NULL;

-- Time-scan (append-heavy)
CREATE INDEX IF NOT EXISTS idx_events_messages_occurred_brin
  ON events_messages USING BRIN (occurred_at);

-- ============================================================
-- Source: 05_observability/008_create_events_profiles.sql
-- ============================================================

-- Canonical CPU/memory profile telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_profiles (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  profile_type TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'info',
  status_code INTEGER,
  name TEXT,
  message TEXT,
  duration_ms NUMERIC(12,3),
  profile_data JSONB,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_profiles_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_profiles_default PARTITION OF events_profiles DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_profiles_event_unique
  ON events_profiles (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_project_time
  ON events_profiles (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_tenant_env_time
  ON events_profiles (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_time
  ON events_profiles (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid
  ON events_profiles (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_profiles_type
  ON events_profiles (organization_id, project_id, profile_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_profiles_occurred_brin
  ON events_profiles USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_profiles_watermark
  ON events_profiles (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/009_create_events_replays.sql
-- ============================================================

-- Canonical session replay telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  request_id TEXT,
  segment_id INTEGER,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'info',
  status_code INTEGER,
  name TEXT,
  message TEXT,
  duration_ms NUMERIC(12,3),
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_replays_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_replays_default PARTITION OF events_replays DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_replays_event_unique
  ON events_replays (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_project_time
  ON events_replays (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_org_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_tenant_env_time
  ON events_replays (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_service
  ON events_replays (organization_id, project_id, service, occurred_at DESC)
  WHERE service IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_replays_org_time
  ON events_replays (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_replays_session
  ON events_replays (organization_id, session_id, segment_id, occurred_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_replays_pubid
  ON events_replays (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_replays_occurred_brin
  ON events_replays USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_replays_watermark
  ON events_replays (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 05_observability/010_create_events_cron_checkins.sql
-- ============================================================

-- Canonical cron monitor check-in telemetry (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS events_cron_checkins (
  id UUID NOT NULL DEFAULT uuid_generate_v7(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  api_key_name TEXT NOT NULL,
  event_id UUID NOT NULL,
  request_id TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  session_id TEXT,
  user_id TEXT,
  tenant_id TEXT,
  monitor_slug TEXT NOT NULL,
  monitor_name TEXT,
  status TEXT NOT NULL,
  is_success BOOLEAN DEFAULT FALSE,
  duration_ms NUMERIC(12,3),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  checkin_type TEXT,
  schedule_type TEXT,
  service TEXT,
  server_name TEXT,
  application_name TEXT,
  application_version TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'info',
  message TEXT,
  name TEXT,
  status_code INTEGER,
  expected_schedule TEXT,
  public_id TEXT,
  release TEXT,
  sdk_name TEXT,
  sdk_version TEXT,
  geo_country_code CHAR(2),
  geo_city TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_response JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT events_cron_checkins_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS events_cron_checkins_default PARTITION OF events_cron_checkins DEFAULT;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_cron_checkins_event_unique
  ON events_cron_checkins (organization_id, event_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_project_time
  ON events_cron_checkins (organization_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_tenant_env_time
  ON events_cron_checkins (organization_id, project_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_time
  ON events_cron_checkins (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid
  ON events_cron_checkins (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_monitor_time
  ON events_cron_checkins (organization_id, project_id, monitor_slug, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_status
  ON events_cron_checkins (organization_id, project_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_success
  ON events_cron_checkins (organization_id, project_id, is_success, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_trace
  ON events_cron_checkins (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_release_time
  ON events_cron_checkins (organization_id, project_id, release, occurred_at DESC)
  WHERE release IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_occurred_brin
  ON events_cron_checkins USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_watermark
  ON events_cron_checkins (organization_id, project_id, environment, ingested_at);

-- ============================================================
-- Source: 06_error_groups/001_create_error_groups.sql
-- ============================================================

-- Error group canonical registry and lifecycle state
CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  fingerprint_version SMALLINT NOT NULL DEFAULT 2,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_event_id UUID NOT NULL,
  latest_event_id UUID NOT NULL,
  latest_event_occurred_at TIMESTAMPTZ,
  highest_severity VARCHAR(16) NOT NULL,
  latest_severity VARCHAR(16) NOT NULL,
  is_regression BOOLEAN NOT NULL DEFAULT FALSE,
  regression_count INTEGER NOT NULL DEFAULT 0,
  last_regressed_at TIMESTAMPTZ,
  latest_release VARCHAR(100),
  latest_sdk_version VARCHAR(50),
  latest_application_version VARCHAR(50),
  latest_environment VARCHAR(64),
  latest_service VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  resolved_release VARCHAR(100),
  last_error_message TEXT,
  last_error_name VARCHAR(255),
  last_status_code INTEGER,
  last_trace_id VARCHAR(64),
  last_request_id VARCHAR(64),
  merged_into UUID NULL,
  is_merged BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_error_groups_project_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_pubid
  ON error_groups (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen_v2
  ON error_groups (organization_id, project_id, status, last_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_fingerprint_v2
  ON error_groups (project_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_status_last_seen
  ON error_groups (project_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_occurrence
  ON error_groups (project_id, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_merged_into_v2
  ON error_groups (project_id, merged_into)
  WHERE merged_into IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_groups_resolved_release_v2
  ON error_groups (project_id, resolved_release, resolved_at)
  WHERE status = 'RESOLVED';

CREATE INDEX IF NOT EXISTS idx_error_groups_search
  ON error_groups USING GIN (to_tsvector('english', COALESCE(last_error_name, '') || ' ' || COALESCE(last_error_message, '')));

-- ============================================================
-- Source: 06_error_groups/002_create_error_group_history.sql
-- ============================================================

-- Audit history for error_group changes (status, merge, regression, etc.).
CREATE TABLE IF NOT EXISTS error_group_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_status VARCHAR(32),
  new_status VARCHAR(32),
  event_id UUID,
  release VARCHAR(100),
  occurred_at TIMESTAMPTZ,
  reason TEXT,
  actor_type VARCHAR(32),
  source_group_id UUID,
  target_group_id UUID
);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_id
  ON error_group_history (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_created_v2
  ON error_group_history (group_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_event_v2
  ON error_group_history (event_id)
  WHERE event_id IS NOT NULL;

-- ============================================================
-- Source: 06_error_groups/003_create_analytics_error_groups.sql
-- ============================================================

-- Analytics-dedicated error group read cache and denormalization table
CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  error_name TEXT NOT NULL,
  error_message TEXT,
  culprit TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  user_count BIGINT NOT NULL DEFAULT 1,
  public_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid
  ON analytics_error_groups (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_tenant_time
  ON analytics_error_groups (organization_id, project_id, last_seen_at DESC);

-- ============================================================
-- Source: 07_analytics/001_create_analytics_hourly_rollup.sql
-- ============================================================

-- Pre-aggregated hourly metric rollups (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_hourly_rollup (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  sum NUMERIC(20,6) NOT NULL DEFAULT 0,
  min NUMERIC(20,6),
  max NUMERIC(20,6),
  p50 NUMERIC(20,6),
  p90 NUMERIC(20,6),
  p99 NUMERIC(20,6),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_hourly_rollup_default PARTITION OF analytics_hourly_rollup DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_hourly_rollup_query
  ON analytics_hourly_rollup (organization_id, project_id, environment, metric_name, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_hourly_rollup_brin
  ON analytics_hourly_rollup USING BRIN (bucket);

-- ============================================================
-- Source: 07_analytics/002_create_analytics_daily_rollup.sql
-- ============================================================

-- Pre-aggregated daily metric rollups (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  bucket DATE NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  sum NUMERIC(20,6) NOT NULL DEFAULT 0,
  min NUMERIC(20,6),
  max NUMERIC(20,6),
  p50 NUMERIC(20,6),
  p90 NUMERIC(20,6),
  p99 NUMERIC(20,6),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup_default PARTITION OF analytics_daily_rollup DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_daily_rollup_query
  ON analytics_daily_rollup (organization_id, project_id, environment, metric_name, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_rollup_brin
  ON analytics_daily_rollup USING BRIN (bucket);

-- ============================================================
-- Source: 07_analytics/003_create_analytics_geo_hourly_rollup.sql
-- ============================================================

-- Pre-aggregated geo-traffic hourly rollups (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  city TEXT,
  bucket TIMESTAMPTZ NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  avg_latency_ms NUMERIC(12,3),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_geo_hourly_rollup_default PARTITION OF analytics_geo_hourly_rollup DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_geo_query
  ON analytics_geo_hourly_rollup (organization_id, project_id, environment, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_country
  ON analytics_geo_hourly_rollup (country_code, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_brin
  ON analytics_geo_hourly_rollup USING BRIN (bucket);

-- ============================================================
-- Source: 07_analytics/004_create_analytics_performance_summary.sql
-- ============================================================

-- Pre-aggregated service endpoint performance summaries (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_performance_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  call_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p50_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  p99_duration_ms NUMERIC(12,3),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_performance_summary_default PARTITION OF analytics_performance_summary DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_perf_query
  ON analytics_performance_summary (organization_id, project_id, environment, endpoint, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_perf_brin
  ON analytics_performance_summary USING BRIN (bucket);

-- ============================================================
-- Source: 07_analytics/005_create_analytics_user_sessions.sql
-- ============================================================

-- Pre-aggregated user session duration and telemetry overview (range-partitioned by started_at)
CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms BIGINT,
  duration_seconds INTEGER,
  event_count INTEGER NOT NULL DEFAULT 1,
  error_count INTEGER NOT NULL DEFAULT 0,
  pages TEXT[] NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_crashed BOOLEAN NOT NULL DEFAULT FALSE,
  public_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

CREATE TABLE IF NOT EXISTS analytics_user_sessions_default PARTITION OF analytics_user_sessions DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_time
  ON analytics_user_sessions (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user
  ON analytics_user_sessions (organization_id, user_id, started_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_attrs_gin
  ON analytics_user_sessions USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project_time
  ON analytics_user_sessions (organization_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project_session
  ON analytics_user_sessions (organization_id, project_id, session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_pubid
  ON analytics_user_sessions (organization_id, public_id);

-- ============================================================
-- Source: 07_analytics/006_create_analytics_trace_service_edges.sql
-- ============================================================

-- Distributed trace service dependency map edges (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS analytics_trace_service_edges (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  source_service TEXT NOT NULL,
  target_service TEXT NOT NULL,
  call_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  p95_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, bucket, source_service, target_service)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS analytics_trace_service_edges_default PARTITION OF analytics_trace_service_edges DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_trace_edges_source
  ON analytics_trace_service_edges (source_service, bucket DESC);

-- ============================================================
-- Source: 07_analytics/007_create_analytics_dashboards.sql
-- ============================================================

-- User-customizable telemetry dashboards and visualization state
CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_org ON analytics_dashboards(organization_id, project_id);

-- ============================================================
-- Source: 07_analytics/008_create_analytics_saved_queries.sql
-- ============================================================

-- Saved explorer queries and filter configurations
CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  query_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_saved_queries_org ON analytics_saved_queries(organization_id, project_id);

-- ============================================================
-- Source: 07_analytics/009_create_analytics_alerts.sql
-- ============================================================

-- Analytics threshold alert rules and evaluation metadata
CREATE TABLE IF NOT EXISTS analytics_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  operator analytics_alert_operator NOT NULL,
  threshold NUMERIC(20,6) NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_org ON analytics_alerts(organization_id, project_id);

-- ============================================================
-- Source: 07_analytics/010_create_cron_monitor_state.sql
-- ============================================================

-- State tracking for cron monitor heartbeats and missed executions
CREATE TABLE IF NOT EXISTS cron_monitor_state (
  organization_id           UUID NOT NULL,
  project_id                UUID NOT NULL,
  environment               TEXT NOT NULL,
  monitor_slug              TEXT NOT NULL,
  last_status               TEXT,
  last_checkin_at           TIMESTAMPTZ,
  last_duration_ms          NUMERIC(14,3),
  expected_interval_seconds INTEGER,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  checkin_count_total       BIGINT NOT NULL DEFAULT 0,
  is_missing                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, monitor_slug)
);

CREATE INDEX IF NOT EXISTS idx_cron_monitor_state_missing
  ON cron_monitor_state (organization_id, project_id) WHERE is_missing;

-- ============================================================
-- Source: 07_analytics/011_create_release_comparison.sql
-- ============================================================

-- Comparison state between software releases
CREATE TABLE IF NOT EXISTS release_comparison (
  organization_id        UUID NOT NULL,
  project_id             UUID NOT NULL,
  environment            TEXT NOT NULL,
  release                TEXT NOT NULL,
  baseline_release       TEXT,
  request_count          BIGINT NOT NULL DEFAULT 0,
  baseline_request_count BIGINT NOT NULL DEFAULT 0,
  error_rate_pct         NUMERIC(7,4),
  baseline_error_rate_pct NUMERIC(7,4),
  error_rate_delta_pct   NUMERIC(10,4),
  latency_p95_ms         NUMERIC(14,3),
  baseline_latency_p95_ms NUMERIC(14,3),
  p95_delta_ms           NUMERIC(14,3),
  throughput_delta_pct   NUMERIC(10,4),
  new_error_groups       INTEGER NOT NULL DEFAULT 0,
  verdict                TEXT NOT NULL DEFAULT 'stable',
  first_seen_at          TIMESTAMPTZ,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, release),
  CONSTRAINT release_comparison_verdict_ck
    CHECK (verdict IN ('improved', 'stable', 'degraded', 'insufficient_data'))
);

CREATE INDEX IF NOT EXISTS idx_release_comparison_recent
  ON release_comparison (organization_id, project_id, computed_at DESC);

-- ============================================================
-- Source: 07_analytics/012_create_slo_definition_cache.sql
-- ============================================================

-- Cache of service level objective targets synced for fast evaluation
CREATE TABLE IF NOT EXISTS slo_definition_cache (
  slo_id          UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  target          NUMERIC(6,4) NOT NULL,
  window_days     INTEGER NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slo_definition_cache_tenant
  ON slo_definition_cache (organization_id, project_id, environment);

-- ============================================================
-- Source: 07_analytics/013_create_anomaly_detections.sql
-- ============================================================

-- Automated telemetry anomaly detection events (range-partitioned by detected_at)
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  entity_key      TEXT,
  bucket          TIMESTAMPTZ NOT NULL,
  window_size     TEXT NOT NULL,
  observed_value  NUMERIC(20,6) NOT NULL,
  baseline_value  NUMERIC(20,6) NOT NULL,
  baseline_stddev NUMERIC(20,6),
  deviation_sigma NUMERIC(12,4) NOT NULL,
  direction       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, detected_at),
  CONSTRAINT anomaly_detections_direction_ck CHECK (direction IN ('spike', 'drop')),
  CONSTRAINT anomaly_detections_severity_ck CHECK (severity IN ('info', 'warning', 'critical'))
) PARTITION BY RANGE (detected_at);

CREATE TABLE IF NOT EXISTS anomaly_detections_default PARTITION OF anomaly_detections DEFAULT;

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_scope_time
  ON anomaly_detections (organization_id, project_id, environment, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_metric
  ON anomaly_detections (organization_id, metric_key, detected_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_detections_dedupe
  ON anomaly_detections (organization_id, project_id, environment, metric_key,
                        COALESCE(entity_key, ''), bucket, window_size, detected_at);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_brin
  ON anomaly_detections USING BRIN (detected_at);

-- ============================================================
-- Source: 07_analytics/014_create_analytics_watermarks.sql
-- ============================================================

-- Aggregation progress watermarks for analytics worker processes
CREATE TABLE IF NOT EXISTS analytics_watermarks (
  worker_id            TEXT NOT NULL,
  organization_id      UUID NOT NULL,
  window_size          TEXT NOT NULL,
  watermark_at         TIMESTAMPTZ NOT NULL,
  last_bucket_at       TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed       BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, organization_id, window_size)
);

CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_worker_lag
  ON analytics_watermarks (worker_id, watermark_at);

CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_failing
  ON analytics_watermarks (worker_id, consecutive_failures)
  WHERE consecutive_failures > 0;

-- ============================================================
-- Source: 07_analytics/015_create_analytics_worker_runs.sql
-- ============================================================

-- Analytics aggregation engine worker execution ledger (range-partitioned by started_at)
CREATE TABLE IF NOT EXISTS analytics_worker_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  organization_id UUID,
  window_size     TEXT NOT NULL,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_written    BIGINT NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

CREATE TABLE IF NOT EXISTS analytics_worker_runs_default PARTITION OF analytics_worker_runs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_worker_time
  ON analytics_worker_runs (worker_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_failures
  ON analytics_worker_runs (worker_id, started_at DESC)
  WHERE outcome <> 'success';

CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_brin
  ON analytics_worker_runs USING BRIN (started_at);

-- ============================================================
-- Source: 07_analytics/016_analytics_engine_rollups.sql
-- ============================================================

-- Analytics Engine domain rollup table definitions and generator
CREATE OR REPLACE FUNCTION analytics_engine_create_rollup(
  p_table   TEXT,
  p_shape   TEXT,          -- 'A' | 'B'
  p_partkey TEXT DEFAULT 'bucket'
) RETURNS VOID AS $fn$
DECLARE
  entity_cols TEXT := '';
  pk_cols     TEXT := 'organization_id, project_id, environment, bucket';
BEGIN
  IF p_shape = 'B' THEN
    entity_cols := 'entity_key TEXT NOT NULL, entity_label TEXT,';
    pk_cols := pk_cols || ', entity_key';
  END IF;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %I (
      organization_id UUID        NOT NULL,
      project_id      UUID        NOT NULL,
      environment     TEXT        NOT NULL,
      bucket          TIMESTAMPTZ NOT NULL,
      %s
      sample_count    BIGINT      NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (%s)
    ) PARTITION BY RANGE (%I)
  $sql$, p_table, entity_cols, pk_cols, p_partkey);

  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT',
                 p_table || '_default', p_table);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, bucket DESC)',
    'idx_' || p_table || '_tenant_time', p_table);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING BRIN (bucket)',
                 'idx_' || p_table || '_bucket_brin', p_table);

  IF p_shape = 'B' THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id, project_id, environment, entity_key, bucket DESC)',
      'idx_' || p_table || '_entity_time', p_table);
  END IF;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_add_latency_columns(
  p_table  TEXT,
  p_prefix TEXT DEFAULT 'latency'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I NUMERIC(20,3) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I NUMERIC(14,3),
      ADD COLUMN IF NOT EXISTS %I BIGINT[]
  $sql$, p_table,
     p_prefix || '_sum_ms', p_prefix || '_max_ms',
     p_prefix || '_p50_ms', p_prefix || '_p75_ms', p_prefix || '_p90_ms',
     p_prefix || '_p95_ms', p_prefix || '_p99_ms', p_prefix || '_hist');
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_add_unique_columns(
  p_table   TEXT,
  p_subject TEXT DEFAULT 'users'
) RETURNS VOID AS $fn$
BEGIN
  EXECUTE format($sql$
    ALTER TABLE %I
      ADD COLUMN IF NOT EXISTS %I BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS %I BYTEA
  $sql$, p_table,
     'unique_' || p_subject || '_exact', 'unique_' || p_subject || '_hll');
END;
$fn$ LANGUAGE plpgsql;

-- Execute the declarative table creation map
DO $$
DECLARE
  spec        TEXT;
  parts       TEXT[];
  domain      TEXT;
  shape       TEXT;
  windows     TEXT[];
  w           TEXT;
BEGIN
  FOREACH spec IN ARRAY ARRAY[
    'request_metrics|A|1m,5m,1h,1d',
    'endpoint_metrics|B|1m,5m,1h,1d',
    'service_metrics|B|1m,5m,1h,1d',
    'error_metrics|A|1m,5m,1h,1d',
    'error_group_metrics|B|1m,1h,1d',
    'error_dimension_metrics|B|1h',
    'log_metrics|A|1m,5m,1h,1d',
    'logger_metrics|B|1h',
    'metric_series|B|1m,1h,1d',
    'runtime_metrics|B|1m,1h',
    'gc_metrics|B|1m,1h',
    'span_metrics|B|1m,1h',
    'db_metrics|B|1h',
    'dependency_metrics|B|1h',
    'trace_metrics|A|1m,5m,1h',
    'trace_edge_metrics|B|1h',
    'cron_metrics|B|1m,1h',
    'profile_metrics|B|1h',
    'profile_function_metrics|B|1h',
    'replay_metrics|A|1h',
    'session_metrics|A|1h',
    'user_metrics|A|1d',
    'geo_metrics|B|1h',
    'device_metrics|B|1h',
    'sdk_metrics|B|1h',
    'release_metrics|B|1h',
    'slo_metrics|B|5m,1h',
    'security_metrics|B|1h',
    'usage_metrics|B|1d',
    'cost_metrics|A|1d',
    'ingest_health_metrics|B|5m',
    'alert_metrics|B|1h',
    'ai_metrics|B|1h',
    'project_health|A|5m'
  ] LOOP
    parts   := string_to_array(spec, '|');
    domain  := parts[1];
    shape   := parts[2];
    windows := string_to_array(parts[3], ',');

    FOREACH w IN ARRAY windows LOOP
      PERFORM analytics_engine_create_rollup(domain || '_' || w, shape);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Domain columns
-- ---------------------------------------------------------------------------

-- Requests -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_metrics_1m','request_metrics_5m','request_metrics_1h','request_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS success_count          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS redirect_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bot_count              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_in               BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out              BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count          INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS route_count            INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
    PERFORM analytics_engine_add_unique_columns(t, 'sessions');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS unique_tenants_exact BIGINT NOT NULL DEFAULT 0', t);
  END LOOP;
END $$;

-- Endpoints ------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['endpoint_metrics_1m','endpoint_metrics_5m','endpoint_metrics_1h','endpoint_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS method             TEXT,
        ADD COLUMN IF NOT EXISTS route              TEXT,
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS slow_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_out          BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS lifecycle          TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Services -------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_metrics_1m','service_metrics_5m','service_metrics_1h','service_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count            BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS client_error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_satisfied_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS apdex_tolerating_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count             BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_group_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct       NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS health_score           NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS release_current        TEXT
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

-- Errors ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_metrics_1m','error_metrics_5m','error_metrics_1h','error_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fatal_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warning_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_fingerprints INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS new_group_count    INTEGER NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['error_group_metrics_1m','error_group_metrics_1h','error_group_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS error_name         TEXT,
        ADD COLUMN IF NOT EXISTS message_template   TEXT,
        ADD COLUMN IF NOT EXISTS mechanism          TEXT,
        ADD COLUMN IF NOT EXISTS severity_max       TEXT,
        ADD COLUMN IF NOT EXISTS occurrence_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS service_count      INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS release_first_seen TEXT,
        ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS baseline_count     NUMERIC(20,6),
        ADD COLUMN IF NOT EXISTS regression_score   NUMERIC(10,4),
        ADD COLUMN IF NOT EXISTS is_new_in_window   BOOLEAN NOT NULL DEFAULT FALSE
    $sql$, t);
    PERFORM analytics_engine_add_unique_columns(t, 'users');
  END LOOP;
END $$;

ALTER TABLE error_dimension_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension        TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value  TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_unique_columns('error_dimension_metrics_1h', 'users');

-- Logs -----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['log_metrics_1m','log_metrics_5m','log_metrics_1h','log_metrics_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS total_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS warn_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS info_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS debug_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unique_loggers  INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

ALTER TABLE logger_metrics_1h
  ADD COLUMN IF NOT EXISTS service     TEXT,
  ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warn_count  BIGINT NOT NULL DEFAULT 0;

-- Custom metrics -------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['metric_series_1m','metric_series_1h','metric_series_1d'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS metric_type      TEXT,
        ADD COLUMN IF NOT EXISTS unit             TEXT,
        ADD COLUMN IF NOT EXISTS service          TEXT,
        ADD COLUMN IF NOT EXISTS point_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS value_sum        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_min        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_max        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last       DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_last_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS value_p50        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p95        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS value_p99        DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS tag_cardinality  INTEGER NOT NULL DEFAULT 0
    $sql$, t);
  END LOOP;
END $$;

-- Runtime + GC ---------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['runtime_metrics_1m','runtime_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS heap_used_mb_avg            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_used_mb_max            NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_total_mb_avg           NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS external_mb_avg             NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_avg                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS rss_mb_max                  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_avg          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS active_handles_max          NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p50_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p95_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_p99_ms        NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS eventloop_lag_hist          BIGINT[],
        ADD COLUMN IF NOT EXISTS eventloop_utilization_pct   NUMERIC(7,3)
    $sql$, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['gc_metrics_1m','gc_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service            TEXT,
        ADD COLUMN IF NOT EXISTS gc_type            TEXT,
        ADD COLUMN IF NOT EXISTS pause_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS long_pause_count   BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heap_before_mb_avg NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS heap_after_mb_avg  NUMERIC(14,3),
        ADD COLUMN IF NOT EXISTS reclaimed_mb_sum   NUMERIC(20,3) NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'pause');
  END LOOP;
END $$;

-- Spans / DB / dependencies --------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['span_metrics_1m','span_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS service     TEXT,
        ADD COLUMN IF NOT EXISTS span_name   TEXT,
        ADD COLUMN IF NOT EXISTS kind        TEXT,
        ADD COLUMN IF NOT EXISTS total_count BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t);
    PERFORM analytics_engine_add_latency_columns(t, 'self_time');
  END LOOP;
END $$;

ALTER TABLE db_metrics_1h
  ADD COLUMN IF NOT EXISTS db_system         TEXT,
  ADD COLUMN IF NOT EXISTS db_name           TEXT,
  ADD COLUMN IF NOT EXISTS db_operation      TEXT,
  ADD COLUMN IF NOT EXISTS db_collection     TEXT,
  ADD COLUMN IF NOT EXISTS statement_pattern TEXT,
  ADD COLUMN IF NOT EXISTS service           TEXT,
  ADD COLUMN IF NOT EXISTS call_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('db_metrics_1h');

ALTER TABLE dependency_metrics_1h
  ADD COLUMN IF NOT EXISTS dependency_kind  TEXT,
  ADD COLUMN IF NOT EXISTS dependency_host  TEXT,
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS call_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_5xx_count BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('dependency_metrics_1h');

-- Traces ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trace_metrics_1m','trace_metrics_5m','trace_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS trace_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS partial_count         BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_trace_count     BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_sum        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS span_count_max        INTEGER,
        ADD COLUMN IF NOT EXISTS critical_path_p95_ms  NUMERIC(14,3)
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

ALTER TABLE trace_edge_metrics_1h
  ADD COLUMN IF NOT EXISTS source_service TEXT,
  ADD COLUMN IF NOT EXISTS target_service TEXT,
  ADD COLUMN IF NOT EXISTS call_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count    BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('trace_edge_metrics_1h');

-- Crons ----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cron_metrics_1m','cron_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS monitor_slug       TEXT,
        ADD COLUMN IF NOT EXISTS checkin_count      BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ok_count           BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_count        BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS in_progress_count  BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS missed_count       BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_status        TEXT,
        ADD COLUMN IF NOT EXISTS last_checkin_at    TIMESTAMPTZ
    $sql$, t);
    PERFORM analytics_engine_add_latency_columns(t, 'duration');
  END LOOP;
END $$;

-- Profiles -------------------------------------------------------------------
ALTER TABLE profile_metrics_1h
  ADD COLUMN IF NOT EXISTS service          TEXT,
  ADD COLUMN IF NOT EXISTS profile_type     TEXT,
  ADD COLUMN IF NOT EXISTS profile_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_count_sum BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS node_count_sum   BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('profile_metrics_1h', 'duration');

ALTER TABLE profile_function_metrics_1h
  ADD COLUMN IF NOT EXISTS service        TEXT,
  ADD COLUMN IF NOT EXISTS function_name  TEXT,
  ADD COLUMN IF NOT EXISTS script_url     TEXT,
  ADD COLUMN IF NOT EXISTS line_number    INTEGER,
  ADD COLUMN IF NOT EXISTS hit_count_sum  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS self_share_pct NUMERIC(7,3);

-- Replays / sessions / users -------------------------------------------------
ALTER TABLE replay_metrics_1h
  ADD COLUMN IF NOT EXISTS segment_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dom_event_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE session_metrics_1h
  ADD COLUMN IF NOT EXISTS session_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crashed_session_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_user_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_user_count  BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('session_metrics_1h', 'duration');
SELECT analytics_engine_add_unique_columns('session_metrics_1h', 'users');

ALTER TABLE user_metrics_1d
  ADD COLUMN IF NOT EXISTS dau                   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_users             BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returning_users       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_per_user_avg NUMERIC(12,4);
SELECT analytics_engine_add_unique_columns('user_metrics_1d', 'users');

-- Geo / devices / SDK / releases --------------------------------------------
ALTER TABLE geo_metrics_1h
  ADD COLUMN IF NOT EXISTS country_code  CHAR(2),
  ADD COLUMN IF NOT EXISTS country_name  TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asn_count     INTEGER NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('geo_metrics_1h');
SELECT analytics_engine_add_unique_columns('geo_metrics_1h', 'users');

ALTER TABLE device_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension       TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value TEXT,
  ADD COLUMN IF NOT EXISTS request_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count     BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('device_metrics_1h');
SELECT analytics_engine_add_unique_columns('device_metrics_1h', 'users');

ALTER TABLE sdk_metrics_1h
  ADD COLUMN IF NOT EXISTS sdk_name      TEXT,
  ADD COLUMN IF NOT EXISTS sdk_version   TEXT,
  ADD COLUMN IF NOT EXISTS event_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS project_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

ALTER TABLE release_metrics_1h
  ADD COLUMN IF NOT EXISTS release              TEXT,
  ADD COLUMN IF NOT EXISTS request_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_group_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_error_group_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crash_free_rate      NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS adoption_share_pct   NUMERIC(7,4);
SELECT analytics_engine_add_latency_columns('release_metrics_1h');
SELECT analytics_engine_add_unique_columns('release_metrics_1h', 'users');

-- SLO ------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['slo_metrics_5m','slo_metrics_1h'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %I
        ADD COLUMN IF NOT EXISTS slo_name                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_kind                   TEXT,
        ADD COLUMN IF NOT EXISTS slo_target_pct             NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS good_count                 BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_count                BIGINT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS availability_pct           NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS error_budget_consumed_pct  NUMERIC(9,4),
        ADD COLUMN IF NOT EXISTS burn_rate_1h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_6h               NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS burn_rate_24h              NUMERIC(12,4)
    $sql$, t);
  END LOOP;
END $$;

-- Security -------------------------------------------------------------------
ALTER TABLE security_metrics_1h
  ADD COLUMN IF NOT EXISTS dimension              TEXT,
  ADD COLUMN IF NOT EXISTS dimension_value        TEXT,
  ADD COLUMN IF NOT EXISTS auth_failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forbidden_count        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_limited_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sensitive_access_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_anomaly_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distinct_country_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_score             NUMERIC(6,2);

-- Usage / cost / ingestion ---------------------------------------------------
ALTER TABLE usage_metrics_1d
  ADD COLUMN IF NOT EXISTS signal          TEXT,
  ADD COLUMN IF NOT EXISTS event_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billable_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bytes_estimate  BIGINT NOT NULL DEFAULT 0;

ALTER TABLE cost_metrics_1d
  ADD COLUMN IF NOT EXISTS billable_events         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_micros        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_micros   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_million_micros BIGINT NOT NULL DEFAULT 0;

ALTER TABLE ingest_health_metrics_5m
  ADD COLUMN IF NOT EXISTS signal            TEXT,
  ADD COLUMN IF NOT EXISTS accepted_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dropped_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dlq_count         BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reasons JSONB NOT NULL DEFAULT '{}'::jsonb;
SELECT analytics_engine_add_latency_columns('ingest_health_metrics_5m', 'ingest_lag');

-- Alerts / AI ----------------------------------------------------------------
ALTER TABLE alert_metrics_1h
  ADD COLUMN IF NOT EXISTS rule_id                  UUID,
  ADD COLUMN IF NOT EXISTS rule_name                TEXT,
  ADD COLUMN IF NOT EXISTS triggered_count          BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_count           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_count       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_success_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_failure_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mtta_seconds_avg         NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS mttr_seconds_avg         NUMERIC(14,3);

ALTER TABLE ai_metrics_1h
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS request_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_hit_count   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_consumed  NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_micros       BIGINT NOT NULL DEFAULT 0;
SELECT analytics_engine_add_latency_columns('ai_metrics_1h');

-- Project health -------------------------------------------------------------
ALTER TABLE project_health_5m
  ADD COLUMN IF NOT EXISTS request_count    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_rate_pct   NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS latency_p95_ms   NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS availability_pct NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS open_alert_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS status           TEXT;

-- ---------------------------------------------------------------------------
-- Current-state tables (not rollups: one row per entity, no bucket)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cron_monitor_state (
  organization_id           UUID NOT NULL,
  project_id                UUID NOT NULL,
  environment               TEXT NOT NULL,
  monitor_slug              TEXT NOT NULL,
  last_status               TEXT,
  last_checkin_at           TIMESTAMPTZ,
  last_duration_ms          NUMERIC(14,3),
  expected_interval_seconds INTEGER,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  checkin_count_total       BIGINT NOT NULL DEFAULT 0,
  is_missing                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, monitor_slug)
);
CREATE INDEX IF NOT EXISTS idx_cron_monitor_state_missing
  ON cron_monitor_state(organization_id, project_id) WHERE is_missing;

CREATE TABLE IF NOT EXISTS release_comparison (
  organization_id        UUID NOT NULL,
  project_id             UUID NOT NULL,
  environment            TEXT NOT NULL,
  release                TEXT NOT NULL,
  baseline_release       TEXT,
  request_count          BIGINT NOT NULL DEFAULT 0,
  baseline_request_count BIGINT NOT NULL DEFAULT 0,
  error_rate_pct         NUMERIC(7,4),
  baseline_error_rate_pct NUMERIC(7,4),
  error_rate_delta_pct   NUMERIC(10,4),
  latency_p95_ms         NUMERIC(14,3),
  baseline_latency_p95_ms NUMERIC(14,3),
  p95_delta_ms           NUMERIC(14,3),
  throughput_delta_pct   NUMERIC(10,4),
  new_error_groups       INTEGER NOT NULL DEFAULT 0,
  verdict                TEXT NOT NULL DEFAULT 'stable',
  first_seen_at          TIMESTAMPTZ,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, release),
  CONSTRAINT release_comparison_verdict_ck
    CHECK (verdict IN ('improved', 'stable', 'degraded', 'insufficient_data'))
);
CREATE INDEX IF NOT EXISTS idx_release_comparison_recent
  ON release_comparison(organization_id, project_id, computed_at DESC);

-- SLO definitions are authored in the control plane; the engine caches them so
-- analytics workers never query the control-plane database.
CREATE TABLE IF NOT EXISTS slo_definition_cache (
  slo_id           UUID PRIMARY KEY,
  organization_id  UUID NOT NULL,
  project_id       UUID NOT NULL,
  environment      TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  target_pct       NUMERIC(7,4) NOT NULL,
  window_days      INTEGER NOT NULL DEFAULT 30,
  service          TEXT,
  latency_threshold_ms NUMERIC(14,3),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slo_definition_cache_kind_ck CHECK (kind IN ('availability', 'latency'))
);

ALTER TABLE slo_definition_cache
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'availability',
  ADD COLUMN IF NOT EXISTS target_pct NUMERIC(7,4) NOT NULL DEFAULT 99.9,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS latency_threshold_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_slo_definition_cache_scope
  ON slo_definition_cache(organization_id, project_id, environment) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Anomaly detections
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  entity_key      TEXT,
  bucket          TIMESTAMPTZ NOT NULL,
  window_size     TEXT NOT NULL,
  observed_value  NUMERIC(20,6) NOT NULL,
  baseline_value  NUMERIC(20,6) NOT NULL,
  baseline_stddev NUMERIC(20,6),
  deviation_sigma NUMERIC(12,4) NOT NULL,
  direction       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, detected_at),
  CONSTRAINT anomaly_detections_direction_ck CHECK (direction IN ('spike', 'drop')),
  CONSTRAINT anomaly_detections_severity_ck CHECK (severity IN ('info', 'warning', 'critical'))
) PARTITION BY RANGE (detected_at);
CREATE TABLE IF NOT EXISTS anomaly_detections_default PARTITION OF anomaly_detections DEFAULT;
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_scope_time
  ON anomaly_detections(organization_id, project_id, environment, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_metric
  ON anomaly_detections(organization_id, metric_key, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_detections_dedupe
  ON anomaly_detections(organization_id, project_id, environment, metric_key,
                        COALESCE(entity_key, ''), bucket, window_size, detected_at);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_brin
  ON anomaly_detections USING BRIN (detected_at);

-- ---------------------------------------------------------------------------
-- Engine control tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_watermarks (
  worker_id            TEXT NOT NULL,
  organization_id      UUID NOT NULL,
  window_size          TEXT NOT NULL,
  watermark_at         TIMESTAMPTZ NOT NULL,
  last_bucket_at       TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed       BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, organization_id, window_size)
);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_worker_lag
  ON analytics_watermarks(worker_id, watermark_at);
CREATE INDEX IF NOT EXISTS idx_analytics_watermarks_failing
  ON analytics_watermarks(worker_id, consecutive_failures) WHERE consecutive_failures > 0;
DROP TRIGGER IF EXISTS trg_analytics_watermarks_updated_at ON analytics_watermarks;
CREATE TRIGGER trg_analytics_watermarks_updated_at
  BEFORE UPDATE ON analytics_watermarks
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS analytics_worker_runs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  organization_id UUID,
  window_size     TEXT NOT NULL,
  window_start    TIMESTAMPTZ,
  window_end      TIMESTAMPTZ,
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_written    BIGINT NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT NOT NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (id, started_at),
  CONSTRAINT analytics_worker_runs_outcome_ck
    CHECK (outcome IN ('success', 'partial', 'failed', 'skipped'))
) PARTITION BY RANGE (started_at);
CREATE TABLE IF NOT EXISTS analytics_worker_runs_default PARTITION OF analytics_worker_runs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_worker_time
  ON analytics_worker_runs(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_failures
  ON analytics_worker_runs(worker_id, started_at DESC) WHERE outcome <> 'success';
CREATE INDEX IF NOT EXISTS idx_analytics_worker_runs_brin
  ON analytics_worker_runs USING BRIN (started_at);

-- ---------------------------------------------------------------------------
-- Documentation + freeze markers
-- ---------------------------------------------------------------------------

COMMENT ON TABLE request_metrics_1m IS
  'Analytics engine rollup. Owner: analytics.requests. Read by /analytics/v2/*. Never written by ingestion.';
COMMENT ON TABLE analytics_watermarks IS
  'Analytics engine progress ledger. watermark_at tracks the highest events_*.ingested_at consumed per (worker, org, window).';
COMMENT ON TABLE analytics_worker_runs IS
  'Analytics engine run ledger (14 day retention). Feeds the worker health endpoint and /analytics/v2/system/health.';
COMMENT ON TABLE cron_monitor_state IS
  'Current cron monitor state. Owner: analytics.crons.';
COMMENT ON TABLE release_comparison IS
  'Current release-vs-baseline verdict. Owner: analytics.releases.';
COMMENT ON TABLE slo_definition_cache IS
  'Control-plane SLO definitions mirrored into the Log DB so analytics workers never read the control-plane database.';
COMMENT ON TABLE anomaly_detections IS
  'Statistical anomaly facts derived from *_metrics_1h rollups. Owner: analytics.anomalies.';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'analytics_hourly_rollup','analytics_daily_rollup','analytics_performance_summary',
    'analytics_endpoint_minute','analytics_endpoint_hourly','analytics_endpoint_daily',
    'analytics_service_minute','analytics_service_hourly','analytics_service_daily',
    'analytics_trace_latency','analytics_error_occurrences','analytics_error_regressions',
    'analytics_geo_hourly_rollup','analytics_alerts'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t) THEN
      EXECUTE format(
        'COMMENT ON TABLE %I IS %L', t,
        'FROZEN by 04_analytics/003_analytics_engine_rollups: superseded by the <domain>_metrics_<window> rollups. No reads, no writes. Drop requires explicit approval (docs/analytics/14-implementation-roadmap.md Wave 7).'
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('analytics_engine_ownership',
   'Tables named <domain>_metrics_<window> plus cron_monitor_state, release_comparison, slo_definition_cache, anomaly_detections, analytics_watermarks and analytics_worker_runs are written exclusively by the analytics engine workers (src/modules/analytics-engine). Dashboard APIs read these tables and must not aggregate events_* directly.'),
  ('analytics_engine_sentinels',
   'Rollups store org-wide aggregates with project_id = 00000000-0000-0000-0000-000000000000 and cross-environment aggregates with environment = __all__. Neither value can be produced by ingestion.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

-- ============================================================
-- Source: 08_connectors/001_create_connector_deliveries.sql
-- ============================================================

-- Legacy connector runtime table connector_deliveries (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_default PARTITION OF connector_deliveries DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_deliveries_connector_time ON connector_deliveries (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_status_time ON connector_deliveries (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_request_gin ON connector_deliveries USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_occurred_brin ON connector_deliveries USING BRIN (occurred_at);

-- ============================================================
-- Source: 08_connectors/002_create_connector_delivery_attempts.sql
-- ============================================================

-- Legacy connector runtime table connector_delivery_attempts (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_delivery_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_default PARTITION OF connector_delivery_attempts DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_connector_time ON connector_delivery_attempts (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_status_time ON connector_delivery_attempts (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_request_gin ON connector_delivery_attempts USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_occurred_brin ON connector_delivery_attempts USING BRIN (occurred_at);

-- ============================================================
-- Source: 08_connectors/003_create_connector_health_checks.sql
-- ============================================================

-- Legacy connector runtime table connector_health_checks (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_health_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_default PARTITION OF connector_health_checks DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_connector_time ON connector_health_checks (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_status_time ON connector_health_checks (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_request_gin ON connector_health_checks USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_occurred_brin ON connector_health_checks USING BRIN (occurred_at);

-- ============================================================
-- Source: 08_connectors/004_create_connector_test_runs.sql
-- ============================================================

-- Legacy connector runtime table connector_test_runs (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_test_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_test_runs_default PARTITION OF connector_test_runs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_test_runs_connector_time ON connector_test_runs (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_test_runs_status_time ON connector_test_runs (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_test_runs_request_gin ON connector_test_runs USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_test_runs_occurred_brin ON connector_test_runs USING BRIN (occurred_at);

-- ============================================================
-- Source: 08_connectors/005_create_connector_audit_logs.sql
-- ============================================================

-- Legacy connector runtime table connector_audit_logs (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_default PARTITION OF connector_audit_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_connector_time ON connector_audit_logs (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_status_time ON connector_audit_logs (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_request_gin ON connector_audit_logs USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_occurred_brin ON connector_audit_logs USING BRIN (occurred_at);

-- ============================================================
-- Source: 08_connectors/006_create_connector_deliveries_v2.sql
-- ============================================================

-- Typed connector deliveries v2 runtime (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_deliveries_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  connector_id          UUID NOT NULL,
  route_id              UUID,
  notification_job_id   UUID,
  alert_event_id        UUID,
  channel_kind          notification_channel_kind,
  notification_type     VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity              logdb_severity NOT NULL DEFAULT 'info',
  status                connector_delivery_status_v2 NOT NULL DEFAULT 'pending',
  correlation_id        UUID NOT NULL,
  idempotency_key       VARCHAR(255),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes    INTEGER,
  response_status_code  INTEGER,
  response_body         TEXT,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  error_details         JSONB,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  max_attempts          INTEGER NOT NULL DEFAULT 3,
  first_attempt_at      TIMESTAMPTZ,
  last_attempt_at       TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  next_retry_at         TIMESTAMPTZ,
  duration_ms           INTEGER,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_v2_default PARTITION OF connector_deliveries_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_idem
  ON connector_deliveries_v2 (organization_id, idempotency_key, created_at)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_connector
  ON connector_deliveries_v2 (connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_retry
  ON connector_deliveries_v2 (status, next_retry_at)
  WHERE status = 'retrying' AND next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_job
  ON connector_deliveries_v2 (notification_job_id, created_at DESC)
  WHERE notification_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_correlation
  ON connector_deliveries_v2 (correlation_id);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_channel
  ON connector_deliveries_v2 (organization_id, channel_kind, created_at DESC)
  WHERE channel_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_org_time
  ON connector_deliveries_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_created_brin
  ON connector_deliveries_v2 USING BRIN (created_at);

-- ============================================================
-- Source: 08_connectors/007_create_connector_delivery_attempts_v2.sql
-- ============================================================

-- Detailed connector transmission attempt history (range-partitioned by attempted_at)
CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID NOT NULL,
  delivery_created_at   TIMESTAMPTZ NOT NULL,
  attempt_number        INTEGER NOT NULL,
  status                connector_delivery_status_v2 NOT NULL,
  response_status_code  INTEGER,
  error_category        VARCHAR(64),
  error_message         TEXT,
  response              JSONB,
  duration_ms           INTEGER,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2_default PARTITION OF connector_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_delivery_attempts_v2_idem
  ON connector_delivery_attempts_v2 (delivery_id, attempt_number, attempted_at);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_connector
  ON connector_delivery_attempts_v2 (connector_id, status, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_delivery
  ON connector_delivery_attempts_v2 (delivery_id, attempted_at DESC);

-- ============================================================
-- Source: 08_connectors/008_create_connector_health_checks_v2.sql
-- ============================================================

-- Dedicated connector health probe execution log (range-partitioned by checked_at)
CREATE TABLE IF NOT EXISTS connector_health_checks_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  health_state          VARCHAR(64) NOT NULL,
  response_time_ms      INTEGER,
  error_message         TEXT,
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_v2_default PARTITION OF connector_health_checks_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_connector
  ON connector_health_checks_v2 (connector_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_unhealthy
  ON connector_health_checks_v2 (organization_id, checked_at DESC)
  WHERE health_state <> 'healthy';

-- ============================================================
-- Source: 08_connectors/009_create_connector_test_runs_v2.sql
-- ============================================================

-- User-initiated connector test execution facts (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_test_runs_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  triggered_by          UUID,
  status                VARCHAR(32) NOT NULL,
  response              JSONB,
  error_message         TEXT,
  duration_ms           INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_test_runs_v2_default PARTITION OF connector_test_runs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_test_runs_v2_connector
  ON connector_test_runs_v2 (connector_id, created_at DESC);

-- ============================================================
-- Source: 08_connectors/010_create_connector_audit_logs_v2.sql
-- ============================================================

-- Connector operational audit event stream (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_audit_logs_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID,
  action                VARCHAR(64) NOT NULL,
  actor_type            VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_user_id         UUID,
  previous_state        JSONB,
  new_state             JSONB,
  changes_summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address            INET,
  user_agent            TEXT,
  request_id            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_v2_default PARTITION OF connector_audit_logs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_action
  ON connector_audit_logs_v2 (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_connector
  ON connector_audit_logs_v2 (connector_id, created_at DESC)
  WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_org
  ON connector_audit_logs_v2 (organization_id, created_at DESC);

-- ============================================================
-- Source: 08_connectors/011_create_connector_dead_letters.sql
-- ============================================================

-- Dead-lettered connector notification deliveries for inspection and replay (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_dead_letters (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID,
  delivery_created_at   TIMESTAMPTZ,
  channel_kind          notification_channel_kind,
  notification_job_id   UUID,
  alert_event_id        UUID,
  last_error_category   VARCHAR(64),
  last_error_message    TEXT,
  total_attempts        INTEGER NOT NULL DEFAULT 0,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  replayed_at           TIMESTAMPTZ,
  replayed_by           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_dead_letters_default PARTITION OF connector_dead_letters DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_connector
  ON connector_dead_letters (connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_unreplayed
  ON connector_dead_letters (organization_id, created_at DESC)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_delivery
  ON connector_dead_letters (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/001_create_alert_events_v2.sql
-- ============================================================

-- Canonical append-only alert lifecycle transitions (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_events_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  environment           TEXT,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  fingerprint           VARCHAR(255) NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  kind                  alert_event_kind NOT NULL,
  severity              logdb_severity NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_ids      TEXT[] NOT NULL DEFAULT '{}'::text[],
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key       VARCHAR(255) NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_events_v2_default PARTITION OF alert_events_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_v2_idem
  ON alert_events_v2 (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_fingerprint
  ON alert_events_v2 (organization_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_scope
  ON alert_events_v2 (organization_id, project_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_rule
  ON alert_events_v2 (organization_id, rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_kind
  ON alert_events_v2 (organization_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_occurred_brin
  ON alert_events_v2 USING BRIN (occurred_at);

-- ============================================================
-- Source: 09_alerting/002_create_alert_event_state.sql
-- ============================================================

-- Active/firing alert instance state machine (unpartitioned hot state)
CREATE TABLE IF NOT EXISTS alert_event_state (
  alert_key             VARCHAR(512) PRIMARY KEY,
  organization_id       UUID NOT NULL,
  project_id            UUID,
  environment           TEXT,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  fingerprint           VARCHAR(255) NOT NULL,
  state                 alert_state NOT NULL DEFAULT 'firing',
  current_severity      logdb_severity NOT NULL,
  latest_event_id       UUID NOT NULL,
  latest_event_created_at TIMESTAMPTZ NOT NULL,
  firing_started_at     TIMESTAMPTZ NOT NULL,
  last_fired_at         TIMESTAMPTZ NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL,
  resolved_at           TIMESTAMPTZ,
  auto_resolve_at       TIMESTAMPTZ,
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID,
  acknowledgment_expires_at TIMESTAMPTZ,
  suppressed_at         TIMESTAMPTZ,
  silenced_until        TIMESTAMPTZ,
  silenced_by           UUID,
  duplicate_count       INTEGER NOT NULL DEFAULT 0,
  escalation_step       INTEGER NOT NULL DEFAULT 0,
  next_escalation_at    TIMESTAMPTZ,
  incident_id           UUID,
  payload_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_state_active
  ON alert_event_state (organization_id, state, last_seen_at DESC)
  WHERE state IN ('pending','firing','acknowledged');
CREATE INDEX IF NOT EXISTS idx_alert_event_state_escalation
  ON alert_event_state (next_escalation_at)
  WHERE state = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_autoresolve
  ON alert_event_state (auto_resolve_at)
  WHERE state = 'firing' AND auto_resolve_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_ack_expiry
  ON alert_event_state (acknowledgment_expires_at)
  WHERE state = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_incident
  ON alert_event_state (incident_id)
  WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_latest_event
  ON alert_event_state (latest_event_id);

-- ============================================================
-- Source: 09_alerting/003_create_alert_event_history_v2.sql
-- ============================================================

-- Historical state transitions of alert incidents (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_event_history_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  alert_key             VARCHAR(512) NOT NULL,
  organization_id       UUID NOT NULL,
  from_state            alert_state,
  to_state              alert_state NOT NULL,
  reason                VARCHAR(128) NOT NULL,
  actor_type            VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id              UUID,
  alert_event_id        UUID,
  alert_event_created_at TIMESTAMPTZ,
  context               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_event_history_v2_default PARTITION OF alert_event_history_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_alert
  ON alert_event_history_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_org
  ON alert_event_history_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_event
  ON alert_event_history_v2 (alert_event_id, created_at DESC)
  WHERE alert_event_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/004_create_alert_rule_eval_state.sql
-- ============================================================

-- Evaluation checkpoints for scheduled alert rules
CREATE TABLE IF NOT EXISTS alert_rule_eval_state (
  rule_id               UUID PRIMARY KEY,
  organization_id       UUID NOT NULL,
  last_evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluation_duration_ms INTEGER,
  last_breach_detected_at TIMESTAMPTZ,
  consecutive_breaches  INTEGER NOT NULL DEFAULT 0,
  consecutive_clears    INTEGER NOT NULL DEFAULT 0,
  last_action_at        TIMESTAMPTZ,
  is_firing             BOOLEAN NOT NULL DEFAULT false,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_due ON alert_rule_eval_state (organization_id, last_evaluated_at);

-- ============================================================
-- Source: 09_alerting/005_create_alert_notification_jobs.sql
-- ============================================================

-- Outbound notification dispatch jobs (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_notification_jobs (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  alert_event_id        UUID NOT NULL,
  alert_event_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_key             VARCHAR(512),
  channel_kind          notification_channel_kind NOT NULL,
  rule_action_id        UUID,
  rule_id               UUID,
  binding_id            UUID,
  channel_id            UUID,
  connector_id          UUID,
  route_id              UUID,
  recipient_user_id     UUID,
  recipient_ref         TEXT,
  recipient_type        VARCHAR(64),
  template_id           UUID,
  severity              logdb_severity NOT NULL DEFAULT 'info',
  priority              SMALLINT NOT NULL DEFAULT 0,
  escalation_step       INTEGER NOT NULL DEFAULT 0,
  attempt_epoch         SMALLINT NOT NULL DEFAULT 0,
  status                notification_job_status NOT NULL DEFAULT 'pending',
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipients            JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key       VARCHAR(255) NOT NULL,
  billable              BOOLEAN NOT NULL DEFAULT true,
  notify_after          TIMESTAMPTZ,
  notification_type     VARCHAR(64) NOT NULL DEFAULT 'alert',
  routing_decision_hash VARCHAR(64),
  delivery_mode         VARCHAR(32),
  provider              VARCHAR(64),
  target_connector_id   UUID,
  target_route_id       UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_notification_jobs_default PARTITION OF alert_notification_jobs DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_notification_jobs_idem
  ON alert_notification_jobs (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_alert
  ON alert_notification_jobs (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_pending
  ON alert_notification_jobs (status, priority DESC, created_at ASC)
  WHERE status IN ('pending','queued');
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_channel
  ON alert_notification_jobs (organization_id, channel_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_project_channel
  ON alert_notification_jobs (organization_id, project_id, channel_id, created_at DESC)
  WHERE project_id IS NOT NULL AND channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_rule
  ON alert_notification_jobs (organization_id, rule_id, binding_id, created_at DESC)
  WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_delivery_mode
  ON alert_notification_jobs (organization_id, delivery_mode, status, created_at DESC)
  WHERE delivery_mode IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/006_create_alert_notification_ledger.sql
-- ============================================================

-- Deduplication and throttling history for sent alert notifications (range-partitioned by notified_at)
CREATE TABLE IF NOT EXISTS alert_notification_ledger (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  rule_id               UUID,
  rule_action_id        UUID,
  binding_id            UUID,
  channel_kind          notification_channel_kind NOT NULL,
  recipient_user_id     UUID,
  recipient_fingerprint VARCHAR(255) DEFAULT '',
  notified_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notification_job_id   UUID,
  PRIMARY KEY (id, notified_at)
) PARTITION BY RANGE (notified_at);

CREATE TABLE IF NOT EXISTS alert_notification_ledger_default PARTITION OF alert_notification_ledger DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_action_window
  ON alert_notification_ledger (rule_action_id, notified_at DESC)
  WHERE rule_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_alert_window
  ON alert_notification_ledger (alert_key, notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_brin
  ON alert_notification_ledger USING BRIN (notified_at);

-- ============================================================
-- Source: 09_alerting/007_create_alert_delivery_attempts_v2.sql
-- ============================================================

-- Alert channel transmission attempt attempts (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  alert_event_id        UUID NOT NULL,
  notification_job_id   UUID NOT NULL,
  notification_job_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel_kind          notification_channel_kind NOT NULL,
  connector_id          UUID,
  route_id              UUID,
  recipient_user_id     UUID,
  attempt_number        INTEGER NOT NULL,
  status                notification_job_status NOT NULL,
  response_status_code  INTEGER,
  response_body         TEXT,
  external_message_id   TEXT,
  error_category        VARCHAR(64),
  error_message         TEXT,
  duration_ms           INTEGER,
  latency_ms            INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2_default PARTITION OF alert_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_delivery_attempts_v2_idem
  ON alert_delivery_attempts_v2 (notification_job_id, attempt_number, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_event
  ON alert_delivery_attempts_v2 (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_connector
  ON alert_delivery_attempts_v2 (connector_id, status, created_at DESC)
  WHERE connector_id IS NOT NULL;

-- ============================================================
-- Source: 09_alerting/008_create_alert_acknowledgments_v2.sql
-- ============================================================

-- Human operator alert acknowledgment log (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  user_id               UUID NOT NULL,
  comment               TEXT,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2_default PARTITION OF alert_acknowledgments_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_alert
  ON alert_acknowledgments_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_org
  ON alert_acknowledgments_v2 (organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/009_create_alert_metrics_v2.sql
-- ============================================================

-- Operational metrics and volume facts for the alerting subsystem (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS alert_metrics_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  metric_name           VARCHAR(64) NOT NULL,
  bucket                TIMESTAMPTZ NOT NULL,
  count                 BIGINT NOT NULL DEFAULT 0,
  sum                   NUMERIC(20,6) NOT NULL DEFAULT 0,
  dimensions            JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS alert_metrics_v2_default PARTITION OF alert_metrics_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_metrics_v2_query
  ON alert_metrics_v2 (organization_id, metric_name, bucket DESC);

-- ============================================================
-- Source: 09_alerting/010_create_alert_dead_letter_events_v2.sql
-- ============================================================

-- Alert processing dead-letter queue (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  stage                 VARCHAR(64) NOT NULL,
  source_queue          VARCHAR(128),
  raw_payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  error_stack           TEXT,
  status                VARCHAR(32) NOT NULL DEFAULT 'dead_letter',
  retry_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2_default PARTITION OF alert_dead_letter_events_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_status
  ON alert_dead_letter_events_v2 (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_org
  ON alert_dead_letter_events_v2 (organization_id, created_at DESC);

-- ============================================================
-- Source: 09_alerting/011_create_alert_runtime_idempotency_keys.sql
-- ============================================================

-- Shared idempotency reservation table across alert workers
CREATE TABLE IF NOT EXISTS alert_runtime_idempotency_keys (
  organization_id       UUID NOT NULL,
  namespace             VARCHAR(64) NOT NULL DEFAULT 'notification_job',
  idempotency_key       VARCHAR(255) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (organization_id, namespace, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_runtime_idempotency_created
  ON alert_runtime_idempotency_keys (created_at);

-- ============================================================
-- Source: 09_alerting/012_create_alert_usage_facts.sql
-- ============================================================

-- High-granularity billable/auditable notification delivery facts (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_usage_facts (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  usage_kind            alert_usage_kind NOT NULL,
  channel_kind          notification_channel_kind,
  quantity              INTEGER NOT NULL DEFAULT 1,
  idempotency_key       VARCHAR(255) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_usage_facts_default PARTITION OF alert_usage_facts DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_usage_facts_idem
  ON alert_usage_facts (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_usage_facts_org_kind
  ON alert_usage_facts (organization_id, usage_kind, created_at DESC);

-- ============================================================
-- Source: 09_alerting/013_create_user_notification_preferences.sql
-- ============================================================

-- End-user personal notification channel routing preferences
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  user_id               UUID NOT NULL,
  channel_kind          notification_channel_kind NOT NULL,
  destination           VARCHAR(255) NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, channel_kind)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_active
  ON user_notification_preferences (organization_id, user_id, enabled);

-- ============================================================
-- Source: 10_ai/0010_create_ai_feedback.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_feedback (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_feedback_default PARTITION OF ai_feedback DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_feedback_org_time ON ai_feedback (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_environment_time ON ai_feedback (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_model_time ON ai_feedback (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_feedback_cache_key ON ai_feedback (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_feedback_metadata_gin ON ai_feedback USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_occurred_brin ON ai_feedback USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/001_create_ai_requests.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_requests (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_requests_default PARTITION OF ai_requests DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_requests_org_time ON ai_requests (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_environment_time ON ai_requests (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_model_time ON ai_requests (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_requests_cache_key ON ai_requests (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_requests_metadata_gin ON ai_requests USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_requests_occurred_brin ON ai_requests USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/002_create_ai_responses.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_responses (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_responses_default PARTITION OF ai_responses DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_responses_org_time ON ai_responses (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_environment_time ON ai_responses (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_model_time ON ai_responses (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_responses_cache_key ON ai_responses (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_responses_metadata_gin ON ai_responses USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_responses_occurred_brin ON ai_responses USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/003_create_ai_jobs.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_jobs (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_jobs_default PARTITION OF ai_jobs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_jobs_org_time ON ai_jobs (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_environment_time ON ai_jobs (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_model_time ON ai_jobs (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_cache_key ON ai_jobs (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_metadata_gin ON ai_jobs USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_occurred_brin ON ai_jobs USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/004_create_ai_cache.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_cache (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_cache_default PARTITION OF ai_cache DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_cache_org_time ON ai_cache (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cache_environment_time ON ai_cache (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cache_model_time ON ai_cache (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_cache_cache_key ON ai_cache (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_cache_metadata_gin ON ai_cache USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_cache_occurred_brin ON ai_cache USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/005_create_ai_event_insights.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_event_insights (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_event_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_event_insights_default PARTITION OF ai_event_insights DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_event_insights_org_time ON ai_event_insights (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_event_insights_environment_time ON ai_event_insights (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_event_insights_model_time ON ai_event_insights (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_event_insights_cache_key ON ai_event_insights (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_event_insights_metadata_gin ON ai_event_insights USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_event_insights_occurred_brin ON ai_event_insights USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/006_create_ai_evaluations.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_evaluations (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_evaluations (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_evaluations_default PARTITION OF ai_evaluations DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_org_time ON ai_evaluations (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_environment_time ON ai_evaluations (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_model_time ON ai_evaluations (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_cache_key ON ai_evaluations (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_metadata_gin ON ai_evaluations USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_occurred_brin ON ai_evaluations USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/007_create_ai_reports.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_reports (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_reports_default PARTITION OF ai_reports DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_reports_org_time ON ai_reports (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_environment_time ON ai_reports (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_model_time ON ai_reports (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_reports_cache_key ON ai_reports (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_reports_metadata_gin ON ai_reports USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_reports_occurred_brin ON ai_reports USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/008_create_ai_usage_receipts.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_usage_receipts (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_usage_receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_usage_receipts_default PARTITION OF ai_usage_receipts DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_org_time ON ai_usage_receipts (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_environment_time ON ai_usage_receipts (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_model_time ON ai_usage_receipts (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_cache_key ON ai_usage_receipts (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_metadata_gin ON ai_usage_receipts USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_usage_receipts_occurred_brin ON ai_usage_receipts USING BRIN (occurred_at);

-- ============================================================
-- Source: 10_ai/009_create_ai_tool_calls.sql
-- ============================================================

-- AI subsystem runtime telemetry for ai_tool_calls (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT,
  user_id UUID,
  model TEXT,
  provider TEXT,
  status logdb_ai_status,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd NUMERIC(18,8),
  cache_key TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS ai_tool_calls_default PARTITION OF ai_tool_calls DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_org_time ON ai_tool_calls (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_environment_time ON ai_tool_calls (project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_model_time ON ai_tool_calls (model, occurred_at DESC) WHERE model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_cache_key ON ai_tool_calls (cache_key, occurred_at DESC) WHERE cache_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_metadata_gin ON ai_tool_calls USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_occurred_brin ON ai_tool_calls USING BRIN (occurred_at);

-- ============================================================
-- Source: 11_outbox/001_create_telemetry_outbox.sql
-- ============================================================

-- High-throughput telemetry outbox buffer for downstream workers and external bridges (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id               BIGSERIAL,
  organization_id  UUID NOT NULL,
  project_id       UUID,
  environment      TEXT,
  signal_kind      TEXT NOT NULL,
  event_id         UUID NOT NULL,
  severity         logdb_severity DEFAULT 'info',
  fast_path        BOOLEAN NOT NULL DEFAULT false,
  attributes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at     TIMESTAMPTZ,
  claimed_at       TIMESTAMPTZ,
  claimed_by       TEXT,
  claim_owner      TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT telemetry_outbox_environment_string_ck CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT telemetry_outbox_signal_kind_ck CHECK (
    signal_kind IN (
      'request_error_threshold_breached',
      'error_occurred',
      'cron_checkin_missed',
      'metric_anomaly_detected',
      'span_error_detected',
      'alert_domain_event'
    )
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS telemetry_outbox_default PARTITION OF telemetry_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_outbox_idem
  ON telemetry_outbox (organization_id, signal_kind, event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_unpublished
  ON telemetry_outbox (fast_path DESC, created_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_claimed
  ON telemetry_outbox (claimed_at)
  WHERE published_at IS NULL AND claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_alert_unpublished
  ON telemetry_outbox (created_at)
  WHERE published_at IS NULL AND signal_kind = 'alert_domain_event';
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_fast_claim
  ON telemetry_outbox (created_at ASC)
  WHERE published_at IS NULL AND fast_path = TRUE;

-- ============================================================
-- Source: 11_outbox/002_create_error_group_regression_outbox.sql
-- ============================================================

-- Dead-letter and regression notification outbox for reopened error groups (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS error_group_regression_outbox (
  id                  BIGSERIAL,
  organization_id     UUID NOT NULL,
  project_id          UUID NOT NULL,
  environment         TEXT NOT NULL,
  error_group_id      UUID NOT NULL,
  fingerprint         TEXT NOT NULL,
  resolved_in_release TEXT,
  reopened_in_release TEXT,
  triggering_event_id UUID NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at        TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  claim_owner         TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT eg_regr_outbox_env_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS error_group_regression_outbox_default PARTITION OF error_group_regression_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_error_group_regression_outbox_idem
  ON error_group_regression_outbox (organization_id, error_group_id, triggering_event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_error_group_regression_outbox_unpublished
  ON error_group_regression_outbox (created_at)
  WHERE published_at IS NULL;

-- ============================================================
-- Source: 12_search/001_create_error_search_index.sql
-- ============================================================

-- Full-text inverted index for error messages, stack frames, and culprit functions (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS error_search_index (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  source_event_id UUID,
  source_table TEXT NOT NULL,
  search_text TEXT NOT NULL,
  facets JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding REAL[],
  occurred_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT error_search_index_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS error_search_index_default PARTITION OF error_search_index DEFAULT;

CREATE INDEX IF NOT EXISTS idx_error_search_index_text_gin ON error_search_index USING GIN (to_tsvector('english', search_text));
CREATE INDEX IF NOT EXISTS idx_error_search_index_facets_gin ON error_search_index USING GIN (facets);
CREATE INDEX IF NOT EXISTS idx_error_search_index_tenant_env_time ON error_search_index (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_search_index_occurred_brin ON error_search_index USING BRIN (occurred_at);

-- ============================================================
-- Source: 12_search/001_create_log_search_index.sql
-- ============================================================

-- Full-text inverted index for log messages and structured attributes (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS log_search_index (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  source_event_id UUID,
  source_table TEXT NOT NULL,
  search_text TEXT NOT NULL,
  facets JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding REAL[],
  occurred_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT log_search_index_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS log_search_index_default PARTITION OF log_search_index DEFAULT;

CREATE INDEX IF NOT EXISTS idx_log_search_index_text_gin ON log_search_index USING GIN (to_tsvector('english', search_text));
CREATE INDEX IF NOT EXISTS idx_log_search_index_facets_gin ON log_search_index USING GIN (facets);
CREATE INDEX IF NOT EXISTS idx_log_search_index_tenant_env_time ON log_search_index (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_search_index_occurred_brin ON log_search_index USING BRIN (occurred_at);

-- ============================================================
-- Source: 12_search/001_create_trace_search_index.sql
-- ============================================================

-- Full-text inverted index for distributed traces and span hierarchies (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS trace_search_index (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  source_event_id UUID,
  source_table TEXT NOT NULL,
  search_text TEXT NOT NULL,
  facets JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding REAL[],
  occurred_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT trace_search_index_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS trace_search_index_default PARTITION OF trace_search_index DEFAULT;

CREATE INDEX IF NOT EXISTS idx_trace_search_index_text_gin ON trace_search_index USING GIN (to_tsvector('english', search_text));
CREATE INDEX IF NOT EXISTS idx_trace_search_index_facets_gin ON trace_search_index USING GIN (facets);
CREATE INDEX IF NOT EXISTS idx_trace_search_index_tenant_env_time ON trace_search_index (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_search_index_occurred_brin ON trace_search_index USING BRIN (occurred_at);

-- ============================================================
-- Source: 13_geo/001_create_geo_countries.sql
-- ============================================================

-- ISO country code reference and IP geolocation lookup
CREATE TABLE IF NOT EXISTS geo_countries (
  country_code CHAR(2) PRIMARY KEY,
  name TEXT NOT NULL,
  continent_code CHAR(2),
  is_eu BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Source: 13_geo/002_create_geo_networks.sql
-- ============================================================

-- Network CIDR subnet lookup for IP intelligence and AS numbers
CREATE TABLE IF NOT EXISTS geo_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr CIDR NOT NULL,
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  asn INTEGER,
  isp TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cidr)
);

CREATE INDEX IF NOT EXISTS idx_geo_networks_country ON geo_networks(country_code);

-- ============================================================
-- Source: 13_geo/003_create_geo_locations.sql
-- ============================================================

-- Geographic location coordinates, regions, and timezones
CREATE TABLE IF NOT EXISTS geo_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2),
  region TEXT,
  city TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  timezone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, region, city)
);

CREATE INDEX IF NOT EXISTS idx_geo_locations_country_region ON geo_locations(country_code, region);

-- ============================================================
-- Source: 14_retention/001_create_retention_jobs.sql
-- ============================================================

-- Automated database partition pruning and retention enforcement queue (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS retention_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  partition_name TEXT,
  cutoff_at TIMESTAMPTZ NOT NULL,
  state logdb_job_state NOT NULL DEFAULT 'pending',
  rows_deleted BIGINT NOT NULL DEFAULT 0,
  bytes_reclaimed BIGINT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS retention_jobs_default PARTITION OF retention_jobs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_retention_jobs_claim ON retention_jobs(state, cutoff_at, created_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_retention_jobs_table_time ON retention_jobs(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_jobs_brin ON retention_jobs USING BRIN (created_at);

-- ============================================================
-- Source: 14_retention/002_create_retention_statistics.sql
-- ============================================================

-- Aggregated statistics on reclaimed space and pruned event volumes (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS retention_statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  bucket DATE NOT NULL,
  rows_pruned BIGINT NOT NULL DEFAULT 0,
  bytes_pruned BIGINT NOT NULL DEFAULT 0,
  oldest_remaining_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS retention_statistics_default PARTITION OF retention_statistics DEFAULT;

CREATE INDEX IF NOT EXISTS idx_retention_statistics_table_bucket ON retention_statistics(table_name, bucket DESC);

-- ============================================================
-- Source: 15_functions/001_functions.sql
-- ============================================================

-- Shared LogDB contract and utility functions

-- 1. Timestamp management
CREATE OR REPLACE FUNCTION logdb_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Alert runtime idempotency reservation helper
CREATE OR REPLACE FUNCTION reserve_alert_runtime_idempotency(
  p_org_id UUID,
  p_idem_key VARCHAR(255),
  p_namespace VARCHAR(64) DEFAULT 'notification_job',
  p_ttl INTERVAL DEFAULT INTERVAL '24 hours'
) RETURNS BOOLEAN AS $$
DECLARE
  v_inserted BOOLEAN;
BEGIN
  INSERT INTO alert_runtime_idempotency_keys(organization_id, namespace, idempotency_key, created_at, expires_at)
  VALUES (p_org_id, p_namespace, p_idem_key, NOW(), NOW() + p_ttl)
  ON CONFLICT (organization_id, namespace, idempotency_key) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted THEN
    RETURN TRUE;
  END IF;

  DELETE FROM alert_runtime_idempotency_keys
  WHERE organization_id = p_org_id
    AND namespace = p_namespace
    AND idempotency_key = p_idem_key
    AND expires_at < NOW();

  INSERT INTO alert_runtime_idempotency_keys(organization_id, namespace, idempotency_key, created_at, expires_at)
  VALUES (p_org_id, p_namespace, p_idem_key, NOW(), NOW() + p_ttl)
  ON CONFLICT (organization_id, namespace, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql;

-- 3. Fast typed-event contract trigger function (<2µs fast-path execution)
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Immediate Fast-Path for Fully-Normalized Hot Path Ingestion
  IF NEW.occurred_at IS NOT NULL
     AND NEW.public_id IS NOT NULL AND NEW.public_id <> ''
     AND NEW.created_at IS NOT NULL
     AND NEW.ingested_at IS NOT NULL
     AND (NEW.payload IS NOT NULL AND NEW.payload <> '{}'::jsonb)
     AND (NEW.metadata IS NOT NULL AND NEW.metadata->>'environment' = NEW.environment) THEN
    RETURN NEW;
  END IF;

  -- 2. Slow-Path Fallback (Guarantees contract safety for ad-hoc / legacy / direct SQL)
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Dedicated error groups contract function
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. User sessions contract function
CREATE OR REPLACE FUNCTION logdb_sync_user_sessions_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Analytics partition management functions
CREATE OR REPLACE FUNCTION analytics_engine_partition_tables()
RETURNS TABLE (table_name TEXT, part_column TEXT, granularity TEXT) AS $fn$
BEGIN
  RETURN QUERY
  SELECT c.relname::TEXT,
         CASE
           WHEN c.relname = 'anomaly_detections'    THEN 'detected_at'
           WHEN c.relname = 'analytics_worker_runs' THEN 'started_at'
           ELSE 'bucket'
         END::TEXT,
         CASE
           WHEN c.relname LIKE '%\_1m' OR c.relname LIKE '%\_5m' THEN 'day'
           WHEN c.relname IN ('anomaly_detections', 'analytics_worker_runs')  THEN 'day'
           ELSE 'month'
         END::TEXT
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'p'
     AND n.nspname = current_schema()
     AND (
       c.relname ~ '_metrics_(1m|5m|1h|1d)$'
       OR c.relname ~ '^metric_series_(1m|1h|1d)$'
       OR c.relname = 'project_health_5m'
       OR c.relname = 'anomaly_detections'
       OR c.relname = 'analytics_worker_runs'
     );
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_ensure_partitions(
  days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $fn$
DECLARE
  rec        RECORD;
  created    INTEGER := 0;
  d          DATE;
  m          DATE;
  part_name  TEXT;
  range_from TIMESTAMPTZ;
  range_to   TIMESTAMPTZ;
BEGIN
  IF days_ahead IS NULL OR days_ahead < 1 THEN
    days_ahead := 1;
  END IF;

  FOR rec IN SELECT * FROM analytics_engine_partition_tables() LOOP
    IF rec.granularity = 'day' THEN
      d := (NOW() AT TIME ZONE 'UTC')::DATE - 1;
      WHILE d <= (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(d, 'YYYYMMDD'));
        range_from := d::TIMESTAMPTZ;
        range_to   := (d + 1)::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        d := d + 1;
      END LOOP;
    ELSE
      m := date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE - INTERVAL '1 month')::DATE;
      WHILE m <= date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead + 31)::DATE LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(m, 'YYYYMM'));
        range_from := m::TIMESTAMPTZ;
        range_to   := (m + INTERVAL '1 month')::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        m := (m + INTERVAL '1 month')::DATE;
      END LOOP;
    END IF;
  END LOOP;

  RETURN created;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_drop_partitions_before(
  p_table  TEXT,
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER AS $fn$
DECLARE
  rec     RECORD;
  dropped INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analytics_engine_partition_tables() WHERE table_name = p_table) THEN
    RAISE EXCEPTION 'Table % is not an analytics_engine partitioned table', p_table;
  END IF;

  FOR rec IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = p_table
       AND c.relname <> p_table || '_default'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', rec.relname);
    dropped := dropped + 1;
  END LOOP;

  RETURN dropped;
END;
$fn$ LANGUAGE plpgsql;

-- 8. High-throughput telemetry table daily partition automation
CREATE OR REPLACE FUNCTION logdb_ensure_daily_partitions(
  p_table_name TEXT,
  p_days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $fn$
DECLARE
  created    INTEGER := 0;
  d          DATE;
  part_name  TEXT;
  range_from TIMESTAMPTZ;
  range_to   TIMESTAMPTZ;
BEGIN
  IF p_days_ahead IS NULL OR p_days_ahead < 1 THEN
    p_days_ahead := 1;
  END IF;

  d := (NOW() AT TIME ZONE 'UTC')::DATE;
  WHILE d <= (NOW() AT TIME ZONE 'UTC')::DATE + p_days_ahead LOOP
    part_name  := format('%s_y%sm%sd%s', p_table_name, to_char(d, 'YYYY'), to_char(d, 'MM'), to_char(d, 'DD'));
    range_from := d::TIMESTAMPTZ;
    range_to   := (d + 1)::TIMESTAMPTZ;

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      BEGIN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          part_name, p_table_name, range_from, range_to
        );
        created := created + 1;
      EXCEPTION
        WHEN duplicate_table THEN
          NULL;
        WHEN check_violation THEN
          NULL;
      END;
    END IF;
    d := d + 1;
  END LOOP;

  RETURN created;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION logdb_drop_daily_partitions_before(
  p_table_name TEXT,
  p_cutoff     TIMESTAMPTZ
) RETURNS INTEGER AS $fn$
DECLARE
  rec     RECORD;
  dropped INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = p_table_name
       AND c.relname <> p_table_name || '_default'
  LOOP
    BEGIN
      EXECUTE format('DROP TABLE IF EXISTS %I', rec.relname);
      dropped := dropped + 1;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END LOOP;

  RETURN dropped;
END;
$fn$ LANGUAGE plpgsql;

-- 9. RFC 9562 Monotonic UUIDv7 Generator
-- Used by primary keys to guarantee sequential right-edge B-tree index appends
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS UUID AS $$
DECLARE
  v_time NUMERIC;
  v_unix_t BIGINT;
  v_rand BYTEA;
  v_output TEXT;
BEGIN
  -- 1. Extract current epoch milliseconds
  v_time := clock_timestamp();
  v_unix_t := (EXTRACT(EPOCH FROM v_time) * 1000)::BIGINT;
  
  -- 2. Generate 10 random bytes for sequence & entropy
  v_rand := gen_random_bytes(10);
  
  -- 3. Construct RFC 9562 UUIDv7 hex representation:
  -- unix_ts_ms (48 bits / 12 hex) | ver (4 bits = '7') | rand_a (12 bits / 3 hex) | var (2 bits = '8'..'b') | rand_b (62 bits)
  v_output := lpad(to_hex(v_unix_t), 12, '0') ||
              '7' ||
              substr(encode(v_rand, 'hex'), 1, 3) ||
              to_hex((8 | (get_byte(v_rand, 2) & 3))::INT) ||
              substr(encode(v_rand, 'hex'), 5, 3) ||
              substr(encode(v_rand, 'hex'), 8, 12);
              
  RETURN v_output::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$
BEGIN
  RETURN uuid_generate_v7();
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================================
-- Source: 05_observability/999_triggers.sql
-- ============================================================

-- Observability canonical triggers
-- Triggers bound to the fast typed-event contract (<2µs fast path)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- Source: 06_error_groups/999_triggers.sql
-- ============================================================

-- Error groups triggers
DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
CREATE TRIGGER trg_sync_error_groups_contract
  BEFORE INSERT OR UPDATE ON error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();

DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
CREATE TRIGGER trg_sync_error_groups_contract
  BEFORE INSERT OR UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();

DROP TRIGGER IF EXISTS trg_analytics_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_analytics_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- ============================================================
-- Source: 07_analytics/999_triggers.sql
-- ============================================================

-- Analytics triggers
DROP TRIGGER IF EXISTS trg_sync_user_sessions_contract ON analytics_user_sessions;
CREATE TRIGGER trg_sync_user_sessions_contract
  BEFORE INSERT OR UPDATE ON analytics_user_sessions
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_user_sessions_contract();

DROP TRIGGER IF EXISTS trg_logdb_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_logdb_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_logdb_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_logdb_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_logdb_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_logdb_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_watermarks_updated_at ON analytics_watermarks;
CREATE TRIGGER trg_analytics_watermarks_updated_at
  BEFORE UPDATE ON analytics_watermarks
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- ============================================================
-- Source: 09_alerting/999_triggers.sql
-- ============================================================

-- Alerting triggers
DROP TRIGGER IF EXISTS trg_alert_event_state_updated_at ON alert_event_state;
CREATE TRIGGER trg_alert_event_state_updated_at
  BEFORE UPDATE ON alert_event_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_alert_rule_eval_state_updated_at ON alert_rule_eval_state;
CREATE TRIGGER trg_alert_rule_eval_state_updated_at
  BEFORE UPDATE ON alert_rule_eval_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- ============================================================
-- Source: 14_retention/999_triggers.sql
-- ============================================================

-- Retention triggers
DROP TRIGGER IF EXISTS trg_retention_jobs_updated_at ON retention_jobs;
CREATE TRIGGER trg_retention_jobs_updated_at
  BEFORE UPDATE ON retention_jobs
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();
