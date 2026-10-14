-- Normalized final definition for user_sessions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/002_create_user_sessions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/010_extend_user_sessions_for_sso_provider_type.up.sql

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL,
  previous_refresh_token_hash VARCHAR(64),
  previous_refresh_rotated_at TIMESTAMPTZ,
  access_token_jti VARCHAR(255),
  device_fingerprint VARCHAR(64),
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  ip_address INET NOT NULL,
  ip_geo_country VARCHAR(2),
  ip_geo_city VARCHAR(100),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  status session_status NOT NULL DEFAULT 'active',
  terminated_at TIMESTAMPTZ,
  terminated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  termination_reason TEXT,
  mfa_verified_at TIMESTAMPTZ,
  mfa_expires_at TIMESTAMPTZ,
  saml_name_id TEXT,
  saml_session_index TEXT,
  sso_provider_id UUID,
  sso_provider_type VARCHAR(50),
  login_method VARCHAR(32)
) WITH (fillfactor = 85);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token
  ON user_sessions(refresh_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token_unique
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions(user_id, status, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active_last_active
  ON user_sessions(user_id, status, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_sessions_purge
  ON user_sessions (status, terminated_at, expires_at)
  WHERE status IN ('revoked', 'expired', 'terminated_by_admin');

CREATE INDEX IF NOT EXISTS idx_sessions_saml_name_id
  ON user_sessions(saml_name_id) WHERE saml_name_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_sso_provider
  ON user_sessions(sso_provider_id, sso_provider_type)
  WHERE sso_provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_terminated_by
  ON user_sessions(terminated_by)
  WHERE terminated_by IS NOT NULL;
