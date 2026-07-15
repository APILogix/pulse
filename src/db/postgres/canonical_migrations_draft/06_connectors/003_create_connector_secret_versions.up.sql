BEGIN;

CREATE TABLE IF NOT EXISTS connector_secret_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    encrypted_value BYTEA NOT NULL,
    rotated_by UUID REFERENCES users(id),
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
