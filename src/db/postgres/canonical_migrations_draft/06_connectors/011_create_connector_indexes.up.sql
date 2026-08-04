-- =============================================================================
-- Connector Module - Enterprise Indexes
-- =============================================================================

BEGIN;

-- ============================================================================
-- connector_configs
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_org
ON connector_configs (organization_id, lower(name))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_org
ON connector_configs (organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_project
ON connector_configs (project_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_provider
ON connector_configs (provider)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_status
ON connector_configs (status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_default
ON connector_configs (organization_id, is_default)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_last_health
ON connector_configs (last_health_check_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_last_delivery
ON connector_configs (last_successful_delivery_at DESC);

-- ============================================================================
-- connector_credentials
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_credential_key
ON connector_credentials (connector_id, key_name);

CREATE INDEX IF NOT EXISTS idx_credentials_connector
ON connector_credentials (connector_id);

CREATE INDEX IF NOT EXISTS idx_credentials_type
ON connector_credentials (credential_type);

CREATE INDEX IF NOT EXISTS idx_credentials_expiry
ON connector_credentials (expires_at)
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_last_used
ON connector_credentials (last_used_at DESC);

-- ============================================================================
-- connector_secret_versions
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_secret_versions_lookup
ON connector_secret_versions (credential_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_secret_rotated_at
ON connector_secret_versions (rotated_at DESC);

-- ============================================================================
-- connector_routes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_routes_connector
ON connector_routes (connector_id);

CREATE INDEX IF NOT EXISTS idx_routes_project
ON connector_routes (project_id);

CREATE INDEX IF NOT EXISTS idx_routes_environment
ON connector_routes (environment);

CREATE INDEX IF NOT EXISTS idx_routes_event
ON connector_routes (event_type);

CREATE INDEX IF NOT EXISTS idx_routes_enabled
ON connector_routes (enabled);

CREATE INDEX IF NOT EXISTS idx_routes_lookup
ON connector_routes (project_id, environment, event_type, severity, enabled);

-- ============================================================================
-- connector_oauth_states
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_state
ON connector_oauth_states (state);

CREATE INDEX IF NOT EXISTS idx_oauth_expiry
ON connector_oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_connector
ON connector_oauth_states (connector_id);

COMMIT;
