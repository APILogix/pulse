-- Normalized final definition for alerting_audit_roots.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_audit_roots (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  root_version INTEGER NOT NULL DEFAULT 1 CHECK (root_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
