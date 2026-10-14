-- API Key lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS api_key_lookup (
  api_key_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  environment_id UUID,
  key_prefix TEXT,
  name TEXT,
  status TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_lookup_org ON api_key_lookup(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_key_lookup_project_env ON api_key_lookup(project_id, environment_id);
