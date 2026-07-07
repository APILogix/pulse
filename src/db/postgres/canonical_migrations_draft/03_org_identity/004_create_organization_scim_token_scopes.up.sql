BEGIN;

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

COMMIT;
