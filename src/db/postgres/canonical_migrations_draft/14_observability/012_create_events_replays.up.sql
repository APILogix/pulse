BEGIN;

CREATE TABLE IF NOT EXISTS events_replays (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  segment_id INTEGER NOT NULL,
  events JSONB NOT NULL,
  trace_id VARCHAR(64),
  user_id VARCHAR(255),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_replays_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_replays_org_session
  ON events_replays(organization_id, session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_replays_brin_time
  ON events_replays USING BRIN (created_at);

COMMIT;
