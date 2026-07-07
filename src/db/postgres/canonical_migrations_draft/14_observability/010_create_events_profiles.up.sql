BEGIN;

CREATE TABLE IF NOT EXISTS events_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  profile_type VARCHAR(50) NOT NULL,
  format VARCHAR(50),
  duration_ms INTEGER,
  sample_count INTEGER,
  profile JSONB,
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_profiles_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_profiles_org_time
  ON events_profiles(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_brin_time
  ON events_profiles USING BRIN (created_at);

COMMIT;
