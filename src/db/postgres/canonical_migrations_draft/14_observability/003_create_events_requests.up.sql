BEGIN;

CREATE TABLE IF NOT EXISTS events_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  route VARCHAR(500),
  framework VARCHAR(50),
  headers JSONB,
  query_params JSONB,
  body JSONB,
  body_size INTEGER,
  response_size INTEGER,
  user_id VARCHAR(255),
  tenant_id VARCHAR(255),
  session_id VARCHAR(64),
  client_ip INET,
  user_agent TEXT,
  referer TEXT,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  is_slow BOOLEAN GENERATED ALWAYS AS (latency_ms > 1000) STORED,
  is_error BOOLEAN GENERATED ALWAYS AS (status_code >= 500) STORED,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_requests_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_requests_org_time
  ON events_requests(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_route
  ON events_requests(organization_id, route, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status
  ON events_requests(organization_id, status_code, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_slow
  ON events_requests(organization_id, timestamp DESC)
  WHERE is_slow = TRUE;
CREATE INDEX IF NOT EXISTS idx_requests_user
  ON events_requests(organization_id, user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_trace
  ON events_requests(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_brin_time
  ON events_requests USING BRIN (created_at);

COMMIT;
