-- =============================================================================
-- Module      : Billing
-- Migration   : 019_billing_audit_logs.sql
-- Description : Immutable billing audit log (partitioned)
-- PostgreSQL  : 16+
-- Depends On  : 006_organization_subscriptions.sql
--               013_invoices.sql
--               014_payments.sql
--               016_coupons.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS billing_audit_logs
(
    id UUID NOT NULL DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE SET NULL,

    invoice_id UUID
        REFERENCES invoices(id)
        ON DELETE SET NULL,

    payment_id UUID
        REFERENCES payments(id)
        ON DELETE SET NULL,

    coupon_id UUID
        REFERENCES coupons(id)
        ON DELETE SET NULL,

    actor_type subscription_event_actor NOT NULL,

    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,

    request_id UUID,
    correlation_id UUID,
    trace_id UUID,

    ip_address INET,
    user_agent TEXT,

    previous_state JSONB,
    new_state JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE billing_audit_logs IS
'Append-only audit trail for all billing operations. Parent table for monthly partitions.';

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_07
PARTITION OF billing_audit_logs
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_org_time
ON billing_audit_logs_2026_07(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_action
ON billing_audit_logs_2026_07(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_actor
ON billing_audit_logs_2026_07(actor_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_07_request
ON billing_audit_logs_2026_07(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_bal_2026_07_time
ON billing_audit_logs_2026_07
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_metadata
ON billing_audit_logs_2026_07
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_previous
ON billing_audit_logs_2026_07
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_new
ON billing_audit_logs_2026_07
USING GIN(new_state);

COMMIT;

-- Notes:
-- * Treat this table as append-only.
-- * Create monthly partitions automatically (pg_partman or scheduler).
-- * Archive/drop partitions according to retention policy.
