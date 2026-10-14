-- Normalized final definition for ingestion_failures.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID,
  org_id UUID,
  event_type VARCHAR(32),
  reason VARCHAR(64) NOT NULL,
  detail TEXT,
  raw_excerpt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_project ON ingestion_failures(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_failures_reason ON ingestion_failures(reason, created_at DESC);
