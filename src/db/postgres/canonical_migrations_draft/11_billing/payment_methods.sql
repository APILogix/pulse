CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    provider billing_provider_type NOT NULL,
    provider_payment_method_id VARCHAR(150) NOT NULL,

    type VARCHAR(30) NOT NULL
        CHECK (type IN ('card', 'bank_transfer', 'upi', 'wallet')),

    last4 VARCHAR(10),
    brand VARCHAR(50),
    expiry_month INTEGER,
    expiry_year INTEGER,

    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    billing_details JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_org_default_payment_method
ON payment_methods (organization_id)
WHERE is_default = TRUE;