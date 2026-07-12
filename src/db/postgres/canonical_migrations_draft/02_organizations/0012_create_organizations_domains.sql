-- =============================================================================
-- Module      : Organization
-- Migration   : 003_organization_verified_domains.sql
-- Description : Organization verified domains
-- PostgreSQL  : 16+
-- Depends On  : 002_organizations.sql
-- =============================================================================

BEGIN;

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

COMMENT ON TABLE organization_verified_domains IS
'Verified email domains owned by an organization. Used for SSO discovery, auto-join and enterprise onboarding.';

-- One domain belongs to only one active organization

CREATE UNIQUE INDEX IF NOT EXISTS uq_verified_domain
ON organization_verified_domains(domain)
WHERE deleted_at IS NULL;

-- Only one primary domain per organization

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

DROP TRIGGER IF EXISTS trg_organization_verified_domains_updated_at
ON organization_verified_domains;

CREATE TRIGGER trg_organization_verified_domains_updated_at
BEFORE UPDATE
ON organization_verified_domains
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;