BEGIN;

CREATE TABLE IF NOT EXISTS connector_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,

    credential_type VARCHAR(50) NOT NULL,
    key_name VARCHAR(100) NOT NULL,

    encrypted_value BYTEA NOT NULL,

    algorithm VARCHAR(50),
    version INTEGER NOT NULL DEFAULT 1,

    expires_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(connector_id,key_name)
);

COMMIT;
