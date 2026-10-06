-- =============================================================================
-- Migration: 000005_weighted_event_credit_billing.up.sql
-- Description: Implement weighted credit-based billing system for telemetry events
-- =============================================================================

-- 1. Create billing_event_credit_weights table
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

-- 2. Alter organization_usage_current_period:
--    - raw_events_count stores unweighted physical events
--    - events_used supports decimal credits (e.g., 0.25, 1.50)
DROP VIEW IF EXISTS v_current_usage;

ALTER TABLE organization_usage_current_period
    ADD COLUMN IF NOT EXISTS raw_events_count BIGINT NOT NULL DEFAULT 0,
    ALTER COLUMN events_used TYPE NUMERIC(14, 4);

CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    event_limit - events_used AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    ai_credit_limit - ai_credits_used AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- 3. Comments for clarity
COMMENT ON TABLE billing_event_credit_weights IS 
'Stores the credit cost per telemetry event type for weighted credit consumption';

COMMENT ON COLUMN billing_event_credit_weights.credit_weight IS 
'Multiplier converting one raw event of this type into billable credits';

COMMENT ON COLUMN organization_usage_current_period.events_used IS 
'Total billable credits consumed in the current period (weighted)';

COMMENT ON COLUMN organization_usage_current_period.raw_events_count IS 
'Total raw (unweighted) events received in the current period';

-- 4. PostgreSQL Functions for weighted credit accounting
DROP FUNCTION IF EXISTS increment_event_usage(UUID, NUMERIC, BIGINT);
DROP FUNCTION IF EXISTS increment_event_usage(UUID, BIGINT);
DROP FUNCTION IF EXISTS increment_event_usage(UUID);
DROP FUNCTION IF EXISTS remaining_event_quota(UUID);

-- Primary stored procedure: increments weighted credits and raw event counts
CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_weighted_credits NUMERIC,
    p_raw_count BIGINT DEFAULT 1
)
RETURNS TABLE(
    events_used NUMERIC,
    event_limit BIGINT,
    overage_events NUMERIC,
    raw_events_count BIGINT,
    is_over_limit BOOLEAN
) AS $$
DECLARE
    v_events_used NUMERIC;
    v_event_limit BIGINT;
    v_overage_events NUMERIC;
    v_raw_events_count BIGINT;
BEGIN
    UPDATE organization_usage_current_period
    SET
        events_used = organization_usage_current_period.events_used + p_weighted_credits,
        raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
        overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
        last_event_at = NOW(),
        updated_at = NOW()
    WHERE organization_id = p_organization_id
      AND (period_start IS NULL OR NOW() BETWEEN period_start AND period_end)
    RETURNING
        organization_usage_current_period.events_used,
        organization_usage_current_period.event_limit,
        organization_usage_current_period.overage_events,
        organization_usage_current_period.raw_events_count
    INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;

    IF NOT FOUND THEN
        UPDATE organization_usage_current_period
        SET
            events_used = organization_usage_current_period.events_used + p_weighted_credits,
            raw_events_count = organization_usage_current_period.raw_events_count + p_raw_count,
            overage_events = GREATEST(0, (organization_usage_current_period.events_used + p_weighted_credits) - organization_usage_current_period.event_limit),
            last_event_at = NOW(),
            updated_at = NOW()
        WHERE organization_id = p_organization_id
        RETURNING
            organization_usage_current_period.events_used,
            organization_usage_current_period.event_limit,
            organization_usage_current_period.overage_events,
            organization_usage_current_period.raw_events_count
        INTO v_events_used, v_event_limit, v_overage_events, v_raw_events_count;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No usage record found for organization %', p_organization_id;
    END IF;

    RETURN QUERY SELECT
        v_events_used,
        v_event_limit,
        v_overage_events,
        v_raw_events_count,
        (v_events_used > v_event_limit);
END;
$$ LANGUAGE plpgsql;

-- Backward-compatible overload for legacy callers passing a single count
CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    raw_events_count = raw_events_count + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- Stored function: checks remaining event credit quota
CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used, 0)::NUMERIC
FROM organization_usage_current_period
WHERE organization_id = p_organization_id
ORDER BY period_end DESC
LIMIT 1;
$$;
