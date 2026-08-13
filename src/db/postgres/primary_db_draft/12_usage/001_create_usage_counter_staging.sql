-- Normalized final definition for usage_counter_staging.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/13_ingestion/010_add_usage_counter_staging_dimensions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  increment_by BIGINT NOT NULL DEFAULT 1 CHECK (increment_by > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  api_key_id UUID,
  event_type TEXT NOT NULL DEFAULT 'all'
);

CREATE INDEX IF NOT EXISTS idx_usage_staging_project
  ON usage_counter_staging(project_id, counter_type, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
  ON usage_counter_staging(created_at);

CREATE INDEX IF NOT EXISTS idx_usage_staging_api_key
  ON usage_counter_staging(api_key_id, event_type, created_at)
  WHERE api_key_id IS NOT NULL;
