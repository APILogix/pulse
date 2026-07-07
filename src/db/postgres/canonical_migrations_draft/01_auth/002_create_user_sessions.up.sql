BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked', 'terminated_by_admin');
  END IF;
END $$;

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
  saml_name_id VARCHAR(255),
  saml_session_index VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token
  ON user_sessions(refresh_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_previous_refresh_token_unique
  ON user_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions(user_id, status, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cleanup
  ON user_sessions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_purge
  ON user_sessions(terminated_at) WHERE terminated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_saml_name_id
  ON user_sessions(saml_name_id) WHERE saml_name_id IS NOT NULL;

COMMIT;
