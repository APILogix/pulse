BEGIN;

CREATE TABLE IF NOT EXISTS connector_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    triggered_by UUID REFERENCES users(id),
    status VARCHAR(30) NOT NULL,
    response JSONB,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
