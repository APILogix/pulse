BEGIN;

CREATE TABLE IF NOT EXISTS connector_audit_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,
    actor_id UUID REFERENCES users(id),
    actor_type VARCHAR(50),

    previous_state JSONB,
    new_state JSONB,
    changes_summary JSONB,

    ip_address INET,
    user_agent TEXT,
    request_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_default
PARTITION OF connector_audit_logs DEFAULT;

COMMIT;
