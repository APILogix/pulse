-- =============================================================================
-- Migration: 000006_minimal_organization_schema.down.sql
-- Description: Reversal for minimal organization schema cleanup.
-- =============================================================================

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
    ADD COLUMN IF NOT EXISTS company_size VARCHAR(50),
    ADD COLUMN IF NOT EXISTS country VARCHAR(100),
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS support_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS billing_address JSONB,
    ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS tax_id_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE organizations
    ALTER COLUMN timezone SET DEFAULT 'UTC';
