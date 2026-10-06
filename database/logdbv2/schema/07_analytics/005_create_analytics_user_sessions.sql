-- Pre-aggregated user session duration and telemetry overview (range-partitioned by started_at)
CREATE TABLE IF NOT EXISTS analytics_user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms BIGINT,
  duration_seconds INTEGER,
  event_count INTEGER NOT NULL DEFAULT 1,
  error_count INTEGER NOT NULL DEFAULT 0,
  pages TEXT[] NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_crashed BOOLEAN NOT NULL DEFAULT FALSE,
  public_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, started_at)
) PARTITION BY RANGE (started_at);

CREATE TABLE IF NOT EXISTS analytics_user_sessions_default PARTITION OF analytics_user_sessions DEFAULT;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_time
  ON analytics_user_sessions (organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user
  ON analytics_user_sessions (organization_id, user_id, started_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_attrs_gin
  ON analytics_user_sessions USING GIN (attributes);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project_time
  ON analytics_user_sessions (organization_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project_session
  ON analytics_user_sessions (organization_id, project_id, session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_pubid
  ON analytics_user_sessions (organization_id, public_id);
