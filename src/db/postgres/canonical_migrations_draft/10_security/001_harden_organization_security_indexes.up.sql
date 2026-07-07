BEGIN;

DROP INDEX IF EXISTS idx_unique_active_invite;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_email_hash
  ON organization_invitations(org_id, email_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_token_hash
  ON organization_invitations(token_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scim_tokens_active_hash
  ON organization_scim_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;

COMMIT;
