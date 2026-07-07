BEGIN;

CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  session_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  event_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  pages TEXT[],
  is_crashed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_user_sessions_unique UNIQUE (organization_id, project_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_org
  ON analytics_user_sessions(organization_id, project_id, started_at DESC);

COMMIT;
