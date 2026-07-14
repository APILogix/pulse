BEGIN;

CREATE TABLE auth_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    to_email VARCHAR(255) NOT NULL,

    subject VARCHAR(500) NOT NULL,

    html TEXT NOT NULL,

    text TEXT NOT NULL,

    template_name VARCHAR(100),

    template_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    dedupe_key VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (
        status IN (
            'pending',
            'processing',
            'sent',
            'failed',
            'cancelled'
        )
    ),

    attempts INTEGER NOT NULL DEFAULT 0,

    max_attempts INTEGER NOT NULL DEFAULT 5,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    processing_started_at TIMESTAMPTZ,

    processing_worker_id UUID,

    processing_expires_at TIMESTAMPTZ,

    last_error TEXT,

    sent_at TIMESTAMPTZ,

    failed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
CREATE INDEX idx_email_pending
ON auth_email_outbox(next_attempt_at, created_at)
WHERE status='pending';
CREATE INDEX idx_email_processing
ON auth_email_outbox(processing_started_at)
WHERE status='processing';
CREATE INDEX idx_email_sent
ON auth_email_outbox(sent_at)
WHERE status='sent';
CREATE INDEX idx_email_sent
ON auth_email_outbox(sent_at)
WHERE status='sent';
CREATE UNIQUE INDEX idx_email_dedupe
ON auth_email_outbox(dedupe_key)
WHERE dedupe_key IS NOT NULL
AND status IN ('pending','processing');