-- Normalized final definition for alerting_search_index_metadata.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql

CREATE TABLE IF NOT EXISTS alerting_search_index_metadata (
  workspace_id UUID PRIMARY KEY REFERENCES alerting_workspaces(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  enabled_entities JSONB NOT NULL DEFAULT '{"policies":true,"incidents":false,"events":false}'::jsonb,
  last_rebuild_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alerting_search_entities CHECK (jsonb_typeof(enabled_entities) = 'object')
);
