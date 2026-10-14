-- Environment lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS environment_lookup (
  environment_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  name TEXT,
  slug TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_environment_lookup_project ON environment_lookup(project_id);
CREATE INDEX IF NOT EXISTS idx_environment_lookup_org ON environment_lookup(organization_id);
