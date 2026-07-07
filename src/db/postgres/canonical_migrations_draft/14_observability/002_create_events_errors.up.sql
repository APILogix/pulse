BEGIN;

CREATE TABLE IF NOT EXISTS events_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  severity event_severity NOT NULL DEFAULT 'error',
  stack_hash VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  source VARCHAR(100) NOT NULL DEFAULT 'capture',
  mechanism VARCHAR(50),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  server_name VARCHAR(100),
  stack_frames JSONB,
  source_context JSONB,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  user_ip INET,
  breadcrumbs JSONB,
  tags JSONB DEFAULT '{}',
  extra JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_errors_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_errors_org_time
  ON events_errors(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_fingerprint
  ON events_errors(organization_id, fingerprint, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_trace
  ON events_errors(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_severity
  ON events_errors(organization_id, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_service
  ON events_errors(organization_id, service, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_user
  ON events_errors(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_errors_brin_time
  ON events_errors USING BRIN (created_at);

COMMIT;
