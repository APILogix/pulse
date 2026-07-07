BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  org_id UUID,
  event_type VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  detail TEXT,
  raw_excerpt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project ON ingestion_failures(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason ON ingestion_failures(reason, created_at DESC);

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
CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;
CREATE INDEX IF NOT EXISTS idx_errors_project_time ON errors(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint ON errors(project_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_unresolved ON errors(project_id, timestamp DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_errors_trace ON errors(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID,
  request_id VARCHAR(64),
  url TEXT,
  method VARCHAR(10),
  status_code INTEGER,
  latency_ms DOUBLE PRECISION,
  body_size INTEGER,
  response_size INTEGER,
  user_id TEXT,
  tenant_id VARCHAR(128),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  route TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  headers JSONB,
  query JSONB,
  timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);
CREATE TABLE IF NOT EXISTS requests_default PARTITION OF requests DEFAULT;
CREATE INDEX IF NOT EXISTS idx_requests_project_time ON requests(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(project_id, status_code, timestamp DESC) WHERE status_code >= 400;
CREATE INDEX IF NOT EXISTS idx_requests_latency ON requests(project_id, latency_ms, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(project_id, route, timestamp DESC) WHERE route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace ON requests(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  occurrences BIGINT NOT NULL DEFAULT 1,
  last_message TEXT,
  error_type VARCHAR(256),
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_error_groups_active ON error_groups(project_id, last_seen DESC) WHERE is_resolved = FALSE;

COMMIT;
