-- Deferred because user_preferences.default_org_id participates in a fresh-schema FK cycle.
ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS fk_user_preferences_default_org_id_organizations;
ALTER TABLE user_preferences
  ADD CONSTRAINT fk_user_preferences_default_org_id_organizations
  FOREIGN KEY (default_org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Deferred because users.current_org_id participates in a fresh-schema FK cycle.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_current_org_id_organizations;
ALTER TABLE users
  ADD CONSTRAINT fk_users_current_org_id_organizations
  FOREIGN KEY (current_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
