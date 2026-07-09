-- =============================================================================
-- Module      : Billing
-- Migration   : 014_payments.sql
-- Description : Payment ledger
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               013_invoices.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payments
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    provider billing_provider_type NOT NULL,

    provider_payment_id VARCHAR(150),
    provider_order_id   VARCHAR(150),

    status billing_payment_status NOT NULL,

    currency CHAR(3) NOT NULL,

    amount BIGINT NOT NULL CHECK (amount >= 0),
    fee_amount BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),

    payment_method VARCHAR(50),
    payment_method_last4 VARCHAR(10),

    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    authorized_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,

    failure_code VARCHAR(100),
    failure_reason TEXT,

    idempotency_key VARCHAR(150),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_provider_payment UNIQUE(provider, provider_payment_id)
);

COMMENT ON TABLE payments IS
'Immutable payment ledger. Supports retries, refunds and reconciliation with external payment providers.';

CREATE INDEX IF NOT EXISTS idx_payments_org
ON payments(organization_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_invoice
ON payments(invoice_id)
WHERE invoice_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_subscription
ON payments(subscription_id)
WHERE subscription_id IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency
ON payments(idempotency_key)
WHERE idempotency_key IS NOT NULL
AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS gin_payments_metadata
ON payments
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_payments_updated_at
ON payments;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE
ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
