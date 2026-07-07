BEGIN;

CREATE TABLE IF NOT EXISTS scim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  meta_version INTEGER NOT NULL DEFAULT 1,
  meta_created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta_last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (org_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_org
  ON scim_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_scim_groups_org_external
  ON scim_groups(org_id, external_id);
CREATE INDEX IF NOT EXISTS idx_scim_groups_org_display_name
  ON scim_groups(org_id, display_name);

COMMIT;
