BEGIN;

CREATE TABLE IF NOT EXISTS analytics_error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  fingerprint VARCHAR(64) NOT NULL,
  error_name VARCHAR(256) NOT NULL,
  message_template TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  total_count INTEGER DEFAULT 0,
  today_count INTEGER DEFAULT 0,
  week_count INTEGER DEFAULT 0,
  month_count INTEGER DEFAULT 0,
  status error_group_status DEFAULT 'unresolved',
  assigned_to UUID,
  services TEXT[],
  environments TEXT[],
  releases TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_error_groups_unique UNIQUE (organization_id, project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_fingerprint
  ON analytics_error_groups(organization_id, project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_groups_org_status
  ON analytics_error_groups(organization_id, status, last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
