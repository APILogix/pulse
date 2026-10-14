-- Normalized final definition for organization_scim_token_scopes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/004_create_organization_scim_token_scopes.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_scim_token_scopes (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  scope VARCHAR(50) NOT NULL CHECK (scope IN (
  'users:read', 'users:write', 'users:delete',
  'groups:read', 'groups:write', 'groups:delete',
  'bulk'
  )),
  PRIMARY KEY (token_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_scopes_scope
  ON organization_scim_token_scopes(scope);
