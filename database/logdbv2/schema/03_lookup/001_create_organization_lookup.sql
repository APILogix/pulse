-- Organization lookup reference table (synced from primary control-plane)
CREATE TABLE IF NOT EXISTS organization_lookup (
  organization_id UUID PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  plan_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
