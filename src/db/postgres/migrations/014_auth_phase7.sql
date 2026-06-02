-- Phase 7 auth: SAML SLO session context, SCIM user external ID mappings.

BEGIN;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS sso_provider_id UUID,
  ADD COLUMN IF NOT EXISTS login_method VARCHAR(32),
  ADD COLUMN IF NOT EXISTS saml_name_id TEXT,
  ADD COLUMN IF NOT EXISTS saml_session_index TEXT;

COMMENT ON COLUMN user_sessions.saml_name_id IS
  'SAML NameID from IdP assertion; required for SP-initiated SLO.';

CREATE TABLE IF NOT EXISTS scim_user_mappings (
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, external_id),
    CONSTRAINT scim_user_mappings_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_user_mappings_user
  ON scim_user_mappings(user_id);

COMMIT;
