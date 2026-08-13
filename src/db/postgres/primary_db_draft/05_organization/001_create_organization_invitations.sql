-- Normalized final definition for organization_invitations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/004_create_organization_invitations.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  email_hash VARCHAR(64)
  GENERATED ALWAYS AS (encode(digest(lower(email), 'sha256'), 'hex')) STORED,
  role org_role NOT NULL DEFAULT 'member',
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status invitation_status NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  resent_count INTEGER NOT NULL DEFAULT 0,
  last_resent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_invite
  ON organization_invitations(org_id, email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_org_invitations_token
  ON organization_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org
  ON organization_invitations(org_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_email_hash
  ON organization_invitations(org_id, email_hash)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending_token_hash
  ON organization_invitations(token_hash)
  WHERE status = 'pending';
