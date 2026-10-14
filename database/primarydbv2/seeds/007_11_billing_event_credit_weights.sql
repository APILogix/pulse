-- =============================================================================
-- Seeder File: 007_11_billing_event_credit_weights.sql
-- Description: Telemetry Event Type Credit Weights for Weighted Billing System
-- Version: 2.0
-- =============================================================================

-- Ensure table exists (idempotent)
CREATE TABLE IF NOT EXISTS billing_event_credit_weights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(64) NOT NULL UNIQUE,
    credit_weight   NUMERIC(8,4) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_event_credit_weights_active
    ON billing_event_credit_weights (is_active)
    WHERE is_active = true;

COMMENT ON TABLE billing_event_credit_weights IS
'Stores the credit cost per telemetry event type for weighted credit consumption';

COMMENT ON COLUMN billing_event_credit_weights.event_type IS
'Unique telemetry event type identifier matching SDK event normalization';

COMMENT ON COLUMN billing_event_credit_weights.credit_weight IS
'Multiplier converting one raw event of this type into billable credits';

-- Remove any obsolete / duplicate event types outside the 10 canonical SDK event types
DELETE FROM billing_event_credit_weights
WHERE event_type NOT IN (
    'request',
    'error',
    'trace',
    'span',
    'log',
    'metric',
    'profile',
    'replay',
    'message',
    'cron_checkin'
);

-- Seed canonical credit weights across all 10 SDK telemetry event types
INSERT INTO billing_event_credit_weights (event_type, credit_weight, description, is_active)
VALUES
    ('request',       1.0000, 'Full HTTP / RPC request',                        true),
    ('error',         1.5000, 'Error / Exception with stack trace',             true),
    ('trace',         0.5000, 'Distributed trace root',                         true),
    ('span',          0.2500, 'Individual trace span',                          true),
    ('log',           0.1200, 'Structured log line',                            true),
    ('metric',        0.1000, 'Custom metric data point',                       true),
    ('profile',       2.0000, 'Continuous CPU / memory profile sample',         true),
    ('replay',        2.0000, 'Session replay recording segment',               true),
    ('message',       0.3000, 'Custom message / breadcrumb',                    true),
    ('cron_checkin',  0.2000, 'Cron monitor check-in heartbeat',                true)
ON CONFLICT (event_type) DO UPDATE SET
    credit_weight = EXCLUDED.credit_weight,
    description   = EXCLUDED.description,
    is_active     = EXCLUDED.is_active,
    updated_at    = NOW();
