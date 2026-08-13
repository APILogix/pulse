-- Normalized final definition for organizations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/02_organizations/001_create_organizations.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/18_alerting_workspace/008_harden_organization_creation_indexes.up.sql

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  logo_url TEXT,
  website_url TEXT,
  industry VARCHAR(100),
  company_size VARCHAR(50),
  country VARCHAR(100),
  timezone VARCHAR(100) DEFAULT 'UTC',
  billing_email VARCHAR(255),
  support_email VARCHAR(255),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  status org_status NOT NULL DEFAULT 'trialing',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billing_address JSONB,
  tax_id VARCHAR(50),
  tax_id_type VARCHAR(20)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_slug_active
  ON organizations(slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orgs_owner
  ON organizations(owner_user_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orgs_status
  ON organizations(status) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_owner
  ON organizations(owner_user_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_slug
  ON organizations(slug)
  WHERE deleted_at IS NULL;
