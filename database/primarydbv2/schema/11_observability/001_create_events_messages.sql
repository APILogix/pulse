-- Normalized final definition for events_messages.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS events_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id UUID NOT NULL,
  message TEXT NOT NULL,
  severity event_severity NOT NULL DEFAULT 'info',
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  request_id VARCHAR(64),
  session_id VARCHAR(64),
  service VARCHAR(100),
  environment VARCHAR(50),
  release VARCHAR(100),
  user_id VARCHAR(255),
  user_ip INET,
  tags JSONB DEFAULT '{}',
  contexts JSONB DEFAULT '{}',
  breadcrumbs JSONB,
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_messages_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_messages_org_time
  ON events_messages(organization_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_messages_brin_time
  ON events_messages USING BRIN (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_messages_project_event
  ON events_messages(project_id, event_id) NULLS NOT DISTINCT;
