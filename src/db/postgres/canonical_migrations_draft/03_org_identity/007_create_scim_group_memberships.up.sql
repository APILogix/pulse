BEGIN;

CREATE TABLE IF NOT EXISTS scim_group_memberships (
  group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_user
  ON scim_group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_org
  ON scim_group_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_scim_group_memberships_group
  ON scim_group_memberships(group_id);

COMMIT;
