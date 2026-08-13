-- Observability Error Groups, Errors & Logs Schema
-- File: 10_observability/002_errors_and_logs.sql

CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  error_type VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_count BIGINT NOT NULL DEFAULT 1,
  user_count BIGINT NOT NULL DEFAULT 1,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_proj_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS events_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id UUID REFERENCES error_groups(id) ON DELETE SET NULL,
  error_type VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  severity alert_severity DEFAULT 'warning',
  environment VARCHAR(64) DEFAULT 'production',
  release VARCHAR(128),
  user_id VARCHAR(128),
  request_id VARCHAR(128),
  trace_id VARCHAR(128),
  payload JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  service VARCHAR(128),
  environment VARCHAR(64) DEFAULT 'production',
  trace_id VARCHAR(128),
  span_id VARCHAR(128),
  attributes JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
