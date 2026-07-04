-- ============================================================================
-- 017_organizations_billing_security_indexes.down.sql
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS uq_sso_providers_active_domain_type;
DROP INDEX IF EXISTS uq_scim_tokens_active_hash;
DROP INDEX IF EXISTS uq_org_api_keys_hash;
DROP INDEX IF EXISTS uq_org_invitations_pending_token_hash;
DROP INDEX IF EXISTS uq_org_invitations_pending_email_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
  ON organization_invitations(org_id, email)
  WHERE status = 'pending';

COMMIT;
