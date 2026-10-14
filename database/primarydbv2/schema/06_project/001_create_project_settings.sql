-- Normalized final definition for project_settings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/004_create_project_settings.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/04_projects/007_create_project_environments.up.sql

CREATE TABLE IF NOT EXISTS project_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_retention_days INTEGER NOT NULL DEFAULT 10,
  sampling_rate NUMERIC(6,5) NOT NULL DEFAULT 1.00000,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}'::text[],
  blocked_domains TEXT[] NOT NULL DEFAULT '{}'::text[],
  pii_scrubbing_enabled BOOLEAN NOT NULL DEFAULT true,
  ip_collection_enabled BOOLEAN NOT NULL DEFAULT true,
  release_tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  session_replay_enabled BOOLEAN NOT NULL DEFAULT false,
  performance_monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  error_monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  log_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  metric_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  trace_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  profile_ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_project_settings_org
  ON project_settings(organization_id);
