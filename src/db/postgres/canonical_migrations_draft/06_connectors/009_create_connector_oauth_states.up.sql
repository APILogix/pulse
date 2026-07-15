BEGIN;

CREATE TABLE IF NOT EXISTS connector_oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID REFERENCES connector_configs(id) ON DELETE CASCADE,
    state VARCHAR(255) NOT NULL UNIQUE,
    code_verifier TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
