BEGIN;

CREATE TABLE IF NOT EXISTS events_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  level log_level NOT NULL,
  message TEXT NOT NULL,
  logger VARCHAR(255),
  request_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  tags JSONB DEFAULT '{}',
  context JSONB DEFAULT '{}',
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_logs_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_logs_org_level_time
  ON events_logs(organization_id, level, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_message
  ON events_logs USING GIN (to_tsvector('english', message));
CREATE INDEX IF NOT EXISTS idx_logs_brin_time
  ON events_logs USING BRIN (created_at);

COMMIT;
