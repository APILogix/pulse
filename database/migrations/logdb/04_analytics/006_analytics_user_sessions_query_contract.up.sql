BEGIN;

-- Analytics-session query/public-id contract.
-- This must live under 04_analytics because analytics_user_sessions is created
-- by 04_analytics/001_analytics_runtime.up.sql. The observability public-id
-- migration runs earlier and must not assume analytics tables already exist.

CREATE SEQUENCE IF NOT EXISTS seq_pubid_sessions START WITH 1 INCREMENT BY 1;

ALTER TABLE analytics_user_sessions
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0'));

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_time
  ON analytics_user_sessions (organization_id, project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_org_project_session_time
  ON analytics_user_sessions (organization_id, project_id, session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_pubid
  ON analytics_user_sessions (organization_id, public_id);

COMMIT;
