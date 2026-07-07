BEGIN;

CREATE TABLE IF NOT EXISTS organization_scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_org
  ON organization_scim_tokens(org_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scim_tokens_org_token_active
  ON organization_scim_tokens(org_id, token_hash)
  WHERE revoked_at IS NULL;

COMMIT;
