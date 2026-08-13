-- Normalized final definition for feature_flags.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/17_enterprise_ingestion/003_feature_flags.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('platform', 'organization', 'project')),
  scope_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_flags_scope_id CHECK (
  (scope = 'platform' AND scope_id IS NULL)
  OR (scope IN ('organization', 'project') AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_key_scope
  ON feature_flags(key, scope, scope_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_feature_flags_scope
  ON feature_flags(scope, scope_id);
