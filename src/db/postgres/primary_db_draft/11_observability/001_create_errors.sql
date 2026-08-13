-- Normalized final definition for errors.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  message TEXT NOT NULL,
  error_type VARCHAR(256) NOT NULL DEFAULT 'UnknownError',
  fingerprint VARCHAR(128) NOT NULL,
  severity VARCHAR(16),
  stack JSONB,
  context JSONB,
  breadcrumbs JSONB,
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(project_id, fingerprint, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_trace ON errors(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_errors_project_time ON errors(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_legacy_errors_fingerprint ON errors(project_id, fingerprint, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON errors(project_id, timestamp DESC) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_errors_trace ON errors(project_id, trace_id) WHERE trace_id IS NOT NULL;
