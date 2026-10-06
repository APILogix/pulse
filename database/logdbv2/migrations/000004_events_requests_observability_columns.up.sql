-- Migration: 000004_events_requests_observability_columns.up.sql
-- Database: LogDB v2
-- Description: Add missing observability generated columns (is_error, is_slow) and ingestion enrichment columns to events_requests and public_id to events_traces

BEGIN;

-- 1. Add generated columns and enrichment columns to events_requests
ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  ADD COLUMN IF NOT EXISTS is_slow BOOLEAN GENERATED ALWAYS AS (COALESCE(duration_ms, latency_ms) > 1000) STORED,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS framework TEXT,
  ADD COLUMN IF NOT EXISTS server_name TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS body_size BIGINT,
  ADD COLUMN IF NOT EXISTS response_size BIGINT,
  ADD COLUMN IF NOT EXISTS span_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS root_span_status TEXT,
  ADD COLUMN IF NOT EXISTS is_partial BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS referer TEXT,
  ADD COLUMN IF NOT EXISTS geo_region TEXT,
  ADD COLUMN IF NOT EXISTS geo_asn INTEGER,
  ADD COLUMN IF NOT EXISTS browser_family TEXT,
  ADD COLUMN IF NOT EXISTS browser_version_major TEXT,
  ADD COLUMN IF NOT EXISTS os_name TEXT,
  ADD COLUMN IF NOT EXISTS os_version_major TEXT,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- 2. Add partial error and slow indexes for events_requests
CREATE INDEX IF NOT EXISTS idx_events_requests_error_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_error = TRUE;

CREATE INDEX IF NOT EXISTS idx_events_requests_slow_time
  ON events_requests (organization_id, project_id, occurred_at DESC)
  WHERE is_slow = TRUE;

-- 3. Add public_id to events_traces
ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS public_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_traces_pubid
  ON events_traces (organization_id, project_id, public_id);

COMMIT;
