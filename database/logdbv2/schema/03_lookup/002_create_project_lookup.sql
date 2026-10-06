-- Project lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS project_lookup (
  project_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT,
  slug TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_project_lookup_org ON project_lookup(organization_id);
