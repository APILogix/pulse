-- Analytics-dedicated error group read cache and denormalization table
CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  error_name TEXT NOT NULL,
  error_message TEXT,
  culprit TEXT,
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  user_count BIGINT NOT NULL DEFAULT 1,
  public_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid
  ON analytics_error_groups (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_tenant_time
  ON analytics_error_groups (organization_id, project_id, last_seen_at DESC);
