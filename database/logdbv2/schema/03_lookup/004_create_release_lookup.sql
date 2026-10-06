-- Release lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS release_lookup (
  release_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  release TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, release)
);

CREATE INDEX IF NOT EXISTS idx_release_lookup_org_project ON release_lookup(organization_id, project_id);
