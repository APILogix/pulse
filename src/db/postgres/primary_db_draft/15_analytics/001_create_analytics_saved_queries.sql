-- Normalized final definition for analytics_saved_queries.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/15_analytics/006_create_analytics_config_tables.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS analytics_saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  query_type VARCHAR(50) NOT NULL,
  query_config JSONB NOT NULL,
  visualization_type VARCHAR(50),
  visualization_config JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_org
  ON analytics_saved_queries(organization_id)
  WHERE deleted_at IS NULL;
