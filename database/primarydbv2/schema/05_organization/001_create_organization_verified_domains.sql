-- Normalized final definition for organization_verified_domains.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/0012_create_organizations_domains.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS organization_verified_domains
(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  auto_join_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  verification_method VARCHAR(30)
  CHECK
  (
  verification_method IN
  (
  'dns_txt',
  'dns_cname',
  'html_file',
  'manual'
  )
  ),
  verification_token VARCHAR(255),
  verification_started_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  last_verification_check_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_domain_lowercase
  CHECK (domain = lower(domain))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_verified_domain
ON organization_verified_domains(domain)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_primary_domain
ON organization_verified_domains(organization_id)
WHERE is_primary = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_org
ON organization_verified_domains(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verified
ON organization_verified_domains(is_verified)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_auto_join
ON organization_verified_domains(auto_join_enabled)
WHERE auto_join_enabled = TRUE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_verification_check
ON organization_verified_domains(last_verification_check_at)
WHERE is_verified = FALSE
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verified_domains_metadata
ON organization_verified_domains
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_org_verified_domains_verified_by
ON organization_verified_domains(verified_by)
WHERE verified_by IS NOT NULL;
