-- =============================================================================
-- Module      : Billing
-- Migration   : 015_billing_webhook_events.sql
-- Description : Billing webhook inbox / idempotency store
-- PostgreSQL  : 16+
-- Depends On  : 001_billing_enums.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS billing_webhook_events
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    provider billing_provider_type NOT NULL,

    provider_event_id VARCHAR(200) NOT NULL,

    event_type VARCHAR(150) NOT NULL,

    organization_id UUID
        REFERENCES organizations(id)
        ON DELETE SET NULL,

    payload JSONB NOT NULL,

    payload_sha256 CHAR(64),

    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,

    api_version VARCHAR(50),

    processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
        CHECK (
            processing_status IN
            ('received','processing','processed','failed','ignored','dead_letter')
        ),

    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),

    next_retry_at TIMESTAMPTZ,

    processing_started_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,

    processing_duration_ms INTEGER
        CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),

    request_id UUID,
    correlation_id UUID,

    last_error TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_provider_event UNIQUE(provider, provider_event_id)
);

COMMENT ON TABLE billing_webhook_events IS
'Inbox table for payment-provider webhooks. Ensures idempotent processing and reliable retry handling.';

CREATE INDEX IF NOT EXISTS idx_bwe_pending
ON billing_webhook_events(next_retry_at, received_at)
WHERE processing_status IN ('received','failed');

CREATE INDEX IF NOT EXISTS idx_bwe_org
ON billing_webhook_events(organization_id, received_at DESC)
WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_status
ON billing_webhook_events(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_bwe_request
ON billing_webhook_events(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwe_received_brin
ON billing_webhook_events
USING BRIN(received_at);

CREATE INDEX IF NOT EXISTS gin_bwe_payload
ON billing_webhook_events
USING GIN(payload);

CREATE INDEX IF NOT EXISTS gin_bwe_metadata
ON billing_webhook_events
USING GIN(metadata);

COMMIT;
