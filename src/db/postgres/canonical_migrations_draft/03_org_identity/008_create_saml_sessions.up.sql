BEGIN;

CREATE TABLE IF NOT EXISTS saml_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES organization_sso_providers(id) ON DELETE CASCADE,
  saml_name_id VARCHAR(512) NOT NULL,
  saml_name_id_format VARCHAR(100),
  saml_session_index VARCHAR(255),
  issuer VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_lookup
  ON saml_sessions(provider_id, saml_name_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_session
  ON saml_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_expiry
  ON saml_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_provider_session_index
  ON saml_sessions(provider_id, saml_session_index)
  WHERE saml_session_index IS NOT NULL;

COMMIT;
