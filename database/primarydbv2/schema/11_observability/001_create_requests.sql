-- Normalized final definition for requests.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

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

CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(project_id, route, timestamp DESC) WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(project_id, status_code, timestamp DESC) WHERE status_code >= 400;

CREATE INDEX IF NOT EXISTS idx_requests_trace ON requests(project_id, trace_id) WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_project_time ON requests(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_requests_latency ON requests(project_id, latency_ms, timestamp DESC);
