BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_owner
  ON organizations(owner_user_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_slug
  ON organizations(slug)
  WHERE deleted_at IS NULL;

COMMIT;
