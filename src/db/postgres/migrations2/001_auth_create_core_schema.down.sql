-- ============================================================================
-- 001_auth_create_core_schema.down.sql
-- ----------------------------------------------------------------------------
-- Clean rollback of everything created by the matching up file.
-- Drops auth-owned tables/triggers/functions in dependency order.
-- Tables owned by other modules (organizations, organization_sso_providers,
-- organization_scim_tokens, organization_members) are left intact.
-- ============================================================================

BEGIN;

-- Triggers / functions first (they reference the tables below).
DROP TRIGGER IF EXISTS users_tombstone_on_delete ON users;
DROP TRIGGER IF EXISTS update_mfa_devices_updated_at ON user_mfa_devices;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP FUNCTION IF EXISTS tombstone_deleted_email();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS check_login_attempts();

-- Auth-owned tables (reverse dependency order).
DROP TABLE IF EXISTS auth_email_outbox;
DROP TABLE IF EXISTS user_linked_identities;
DROP TABLE IF EXISTS user_trusted_devices;
DROP TABLE IF EXISTS email_mfa_otps;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS user_mfa_devices;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS security_events;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS users;

-- Auth-owned ENUM types.
DROP TYPE IF EXISTS security_event_type;
DROP TYPE IF EXISTS session_status;
DROP TYPE IF EXISTS mfa_type;
DROP TYPE IF EXISTS user_status;

COMMIT;

