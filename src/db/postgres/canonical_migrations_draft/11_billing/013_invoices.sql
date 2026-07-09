-- =============================================================================
-- Module      : Billing
-- Migration   : 013_invoices.sql
-- Description : Billing invoices
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS invoices
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    provider billing_provider_type NOT NULL,

    provider_invoice_id VARCHAR(150),

    invoice_number VARCHAR(100) NOT NULL,

    status billing_invoice_status NOT NULL,

    currency CHAR(3) NOT NULL,

    subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

    tax_rate NUMERIC(6,3),
    tax_id_snapshot VARCHAR(100),
    billing_address_snapshot JSONB,

    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,

    overage_events BIGINT NOT NULL DEFAULT 0,
    overage_amount BIGINT NOT NULL DEFAULT 0,

    pdf_url TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_invoice_period
        CHECK(period_end > period_start),

    CONSTRAINT uq_invoice_number UNIQUE(invoice_number)
);

COMMENT ON TABLE invoices IS
'Immutable invoice records generated for subscriptions. Monetary values are stored in the smallest currency unit.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_invoice
ON invoices(provider, provider_invoice_id)
WHERE provider_invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_org
ON invoices(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_subscription
ON invoices(subscription_id, created_at DESC)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_status
ON invoices(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_due
ON invoices(due_at)
WHERE due_at IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_period
ON invoices(period_start, period_end)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_invoice_metadata
ON invoices
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_invoices_updated_at
ON invoices;

CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE
ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
