-- =============================================================================
-- Migration: 000006_minimal_organization_schema.up.sql
-- Description: Minimal organization schema cleanup for India-first launch.
--              Removes dead, unused, and speculative fields from organizations table.
-- =============================================================================

ALTER TABLE organizations
    DROP COLUMN IF EXISTS industry,
    DROP COLUMN IF EXISTS company_size,
    DROP COLUMN IF EXISTS country,
    DROP COLUMN IF EXISTS website_url,
    DROP COLUMN IF EXISTS support_email,
    DROP COLUMN IF EXISTS billing_email,
    DROP COLUMN IF EXISTS billing_address,
    DROP COLUMN IF EXISTS tax_id,
    DROP COLUMN IF EXISTS tax_id_type,
    DROP COLUMN IF EXISTS description;

-- Set default timezone to India standard time ('Asia/Kolkata')
ALTER TABLE organizations
    ALTER COLUMN timezone SET DEFAULT 'Asia/Kolkata';

COMMENT ON TABLE organizations IS 'Core tenant identity for projects, members, and security boundaries';
