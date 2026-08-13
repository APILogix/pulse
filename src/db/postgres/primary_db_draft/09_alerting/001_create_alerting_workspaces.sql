-- Normalized final definition for alerting_workspaces.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  initialized_by VARCHAR(100) NOT NULL,
  initialization_version VARCHAR(100) NOT NULL,
  provisioning_status VARCHAR(20) NOT NULL DEFAULT 'initializing'
  CHECK (provisioning_status IN ('initializing', 'ready', 'failed')),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alerting_workspace_ready_completion CHECK (
  provisioning_status <> 'ready' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_alerting_workspaces_status
  ON alerting_workspaces(provisioning_status, updated_at DESC);
