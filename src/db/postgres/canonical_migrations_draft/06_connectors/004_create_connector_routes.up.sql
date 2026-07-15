BEGIN;

CREATE TABLE IF NOT EXISTS connector_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    environment VARCHAR(30),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(30),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT connector_routes_environment_check
      CHECK (environment IS NULL OR environment IN ('development', 'staging', 'production'))
);

COMMIT;
