BEGIN;

DROP INDEX IF EXISTS idx_user_sessions_sso_provider;
ALTER TABLE user_sessions
  DROP COLUMN IF EXISTS sso_provider_type;

DROP INDEX IF EXISTS idx_scim_tokens_grace_window;
DROP INDEX IF EXISTS idx_scim_tokens_rotated_from;
ALTER TABLE organization_scim_tokens
  DROP COLUMN IF EXISTS grace_period_ends_at,
  DROP COLUMN IF EXISTS rotated_at,
  DROP COLUMN IF EXISTS rotated_from;

DROP INDEX IF EXISTS idx_audit_logs_time_brin;
DROP INDEX IF EXISTS idx_audit_actor_type_id_time;
ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS actor_id,
  DROP COLUMN IF EXISTS actor_type;

DROP INDEX IF EXISTS idx_saml_sessions_provider_session_index;
DROP INDEX IF EXISTS idx_saml_sessions_expiry;
DROP INDEX IF EXISTS idx_saml_sessions_session;
DROP INDEX IF EXISTS idx_saml_sessions_lookup;
DROP TABLE IF EXISTS saml_sessions;

DROP INDEX IF EXISTS idx_scim_group_memberships_group;
DROP INDEX IF EXISTS idx_scim_group_memberships_org;
DROP INDEX IF EXISTS idx_scim_group_memberships_user;
DROP TABLE IF EXISTS scim_group_memberships;

DROP INDEX IF EXISTS idx_scim_groups_org_display_name;
DROP INDEX IF EXISTS idx_scim_groups_org_external;
DROP INDEX IF EXISTS idx_scim_groups_org;
DROP TABLE IF EXISTS scim_groups;

DROP INDEX IF EXISTS idx_scim_token_ips_token;
DROP TABLE IF EXISTS organization_scim_token_ips;

DROP INDEX IF EXISTS idx_scim_token_scopes_scope;
DROP TABLE IF EXISTS organization_scim_token_scopes;

COMMIT;
