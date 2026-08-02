BEGIN;

-- Align the dedicated Log DB's canonical event tables with the typed writer and
-- analytics SQL. The common columns created by 001 remain the shared storage
-- core; this migration adds signal-specific projections without introducing a
-- second event document or an environment UUID.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', t);
    EXECUTE format('UPDATE %I SET timestamp=occurred_at WHERE timestamp IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN timestamp SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN timestamp DROP DEFAULT', t);
    EXECUTE format(
      'UPDATE %I SET metadata=jsonb_build_object(''environment'',environment)',
      t
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (metadata=jsonb_build_object(''environment'',environment))',
      t, t || '_metadata_environment_ck'
    );
  END LOOP;
END $$;

ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS error_group_id UUID,
  ADD COLUMN IF NOT EXISTS error_name TEXT,
  ADD COLUMN IF NOT EXISTS stack_hash TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS mechanism TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS stack_frames JSONB,
  ADD COLUMN IF NOT EXISTS source_context JSONB,
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS user_ip INET,
  ADD COLUMN IF NOT EXISTS breadcrumbs JSONB,
  ADD COLUMN IF NOT EXISTS tags JSONB,
  ADD COLUMN IF NOT EXISTS extra JSONB,
  ADD COLUMN IF NOT EXISTS contexts JSONB;
CREATE INDEX IF NOT EXISTS idx_events_errors_fingerprint_time
  ON events_errors(organization_id, project_id, fingerprint, timestamp DESC);

ALTER TABLE events_messages
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS user_ip INET,
  ADD COLUMN IF NOT EXISTS tags JSONB,
  ADD COLUMN IF NOT EXISTS contexts JSONB,
  ADD COLUMN IF NOT EXISTS breadcrumbs JSONB;

ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS latency_ms NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS framework TEXT,
  ADD COLUMN IF NOT EXISTS headers JSONB,
  ADD COLUMN IF NOT EXISTS query_params JSONB,
  ADD COLUMN IF NOT EXISTS body JSONB,
  ADD COLUMN IF NOT EXISTS body_size BIGINT,
  ADD COLUMN IF NOT EXISTS response_size BIGINT,
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS client_ip INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS referer TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS application_version TEXT,
  ADD COLUMN IF NOT EXISTS geo_country_code CHAR(2),
  ADD COLUMN IF NOT EXISTS geo_region TEXT,
  ADD COLUMN IF NOT EXISTS geo_asn BIGINT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS browser_family TEXT,
  ADD COLUMN IF NOT EXISTS browser_version_major TEXT,
  ADD COLUMN IF NOT EXISTS os_name TEXT,
  ADD COLUMN IF NOT EXISTS os_version_major TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(latency_ms,0) >= 1000) STORED,
  ADD COLUMN IF NOT EXISTS is_error BOOLEAN GENERATED ALWAYS AS (COALESCE(status_code,0) >= 500) STORED;
CREATE INDEX IF NOT EXISTS idx_events_requests_route_time
  ON events_requests(organization_id, project_id, route, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_user_time
  ON events_requests(organization_id, project_id, user_id, timestamp DESC) WHERE user_id IS NOT NULL;

ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS span_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS span_status TEXT,
  ADD COLUMN IF NOT EXISTS status_message TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS is_root_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_http_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_db_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_cache_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_messaging_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exclusive_duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS depth INTEGER,
  ADD COLUMN IF NOT EXISTS events JSONB,
  ADD COLUMN IF NOT EXISTS links JSONB,
  ADD COLUMN IF NOT EXISTS db_system TEXT,
  ADD COLUMN IF NOT EXISTS db_name TEXT,
  ADD COLUMN IF NOT EXISTS db_operation TEXT,
  ADD COLUMN IF NOT EXISTS db_collection TEXT,
  ADD COLUMN IF NOT EXISTS db_statement TEXT,
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS http_url TEXT,
  ADD COLUMN IF NOT EXISTS http_target TEXT,
  ADD COLUMN IF NOT EXISTS http_status_code INTEGER,
  ADD COLUMN IF NOT EXISTS http_status_text TEXT,
  ADD COLUMN IF NOT EXISTS http_response_size BIGINT,
  ADD COLUMN IF NOT EXISTS http_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS http_host TEXT,
  ADD COLUMN IF NOT EXISTS http_route TEXT,
  ADD COLUMN IF NOT EXISTS http_scheme TEXT,
  ADD COLUMN IF NOT EXISTS http_flavor TEXT,
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
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS root_span_name TEXT,
  ADD COLUMN IF NOT EXISTS root_span_id TEXT,
  ADD COLUMN IF NOT EXISTS span_count INTEGER,
  ADD COLUMN IF NOT EXISTS total_duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS response_size BIGINT,
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS root_span_status TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS is_partial BOOLEAN,
  ADD COLUMN IF NOT EXISTS spans_tree JSONB,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS metric_name TEXT,
  ADD COLUMN IF NOT EXISTS metric_type TEXT,
  ADD COLUMN IF NOT EXISTS value DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS tags JSONB,
  ADD COLUMN IF NOT EXISTS count DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sum DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS min DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS max DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS avg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS buckets JSONB,
  ADD COLUMN IF NOT EXISTS p50 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS p75 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS p90 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS p95 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS p99 DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_time
  ON events_metrics(organization_id, project_id, metric_name, timestamp DESC);

ALTER TABLE events_logs
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS args JSONB,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS user_ip INET,
  ADD COLUMN IF NOT EXISTS logger TEXT,
  ADD COLUMN IF NOT EXISTS context JSONB,
  ADD COLUMN IF NOT EXISTS tags JSONB;
CREATE INDEX IF NOT EXISTS idx_events_logs_level_time
  ON events_logs(organization_id, project_id, level, timestamp DESC);

ALTER TABLE events_profiles
  ADD COLUMN IF NOT EXISTS profile_type TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_data JSONB;

ALTER TABLE events_cron_checkins
  ADD COLUMN IF NOT EXISTS monitor_slug TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE events_replays
  ADD COLUMN IF NOT EXISTS segment_id INTEGER,
  ADD COLUMN IF NOT EXISTS events JSONB;

-- Keep the partition key, analytics timestamp alias, mandatory metadata, and
-- canonical payload synchronized for every writer insert.
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  NEW.timestamp := COALESCE(NEW.timestamp, NEW.occurred_at, NOW());
  NEW.occurred_at := NEW.timestamp;
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);
  NEW.metadata := jsonb_build_object('environment', NEW.environment);
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW)
      - 'payload' - 'attributes' - 'metadata';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
      t
    );
  END LOOP;
END $$;

COMMIT;
