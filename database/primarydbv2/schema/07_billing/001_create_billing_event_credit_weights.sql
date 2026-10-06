-- Normalized final definition for billing_event_credit_weights.
-- Canonical source: database/primarydbv2/migrations/000005_weighted_event_credit_billing.up.sql

CREATE TABLE IF NOT EXISTS billing_event_credit_weights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(64) NOT NULL UNIQUE,
    credit_weight   NUMERIC(8,4) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying active event credit weights
CREATE INDEX IF NOT EXISTS idx_billing_event_credit_weights_active
    ON billing_event_credit_weights (is_active)
    WHERE is_active = true;

COMMENT ON TABLE billing_event_credit_weights IS 
'Stores the credit cost per telemetry event type for weighted credit consumption';

COMMENT ON COLUMN billing_event_credit_weights.credit_weight IS 
'Multiplier converting one raw event of this type into billable credits';
