BEGIN;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS sso_provider_id UUID,
  ADD COLUMN IF NOT EXISTS sso_provider_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS login_method VARCHAR(32),
  ADD COLUMN IF NOT EXISTS saml_name_id TEXT,
  ADD COLUMN IF NOT EXISTS saml_session_index TEXT;

CREATE INDEX IF NOT EXISTS idx_user_sessions_sso_provider
  ON user_sessions(sso_provider_id, sso_provider_type)
  WHERE sso_provider_id IS NOT NULL;

COMMIT;
