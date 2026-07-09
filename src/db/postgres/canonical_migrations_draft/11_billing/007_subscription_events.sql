-- =============================================================================
-- Module      : Billing
-- Migration   : 007_subscription_events.sql
-- Description : Immutable subscription event history
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
--               006_organization_subscriptions.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_events
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID NOT NULL
        REFERENCES organization_subscriptions(id)
        ON DELETE CASCADE,

    event_type subscription_event_type NOT NULL,

    actor subscription_event_actor NOT NULL,

    actor_user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    old_plan_id UUID
        REFERENCES plans(id)
        ON DELETE SET NULL,

    new_plan_id UUID
        REFERENCES plans(id)
        ON DELETE SET NULL,

    request_id UUID,
    correlation_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE subscription_events IS
'Immutable audit trail of all subscription lifecycle events. Rows are append-only.';

CREATE INDEX IF NOT EXISTS idx_subscription_events_org_time
ON subscription_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_time
ON subscription_events (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_event
ON subscription_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_actor
ON subscription_events (actor, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_request
ON subscription_events (request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_events_metadata
ON subscription_events
USING GIN (metadata);

COMMIT;
