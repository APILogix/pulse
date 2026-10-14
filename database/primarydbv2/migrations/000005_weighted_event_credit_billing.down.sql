-- =============================================================================
-- Migration: 000005_weighted_event_credit_billing.down.sql
-- Description: Rollback weighted credit-based billing system schema changes
-- =============================================================================

ALTER TABLE organization_usage_current_period
    DROP COLUMN IF EXISTS raw_events_count;

DROP TABLE IF EXISTS billing_event_credit_weights;
