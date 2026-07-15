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
-- connector_deliveries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_delivery_connector
ON connector_deliveries (connector_id);

CREATE INDEX IF NOT EXISTS idx_delivery_org_created
ON connector_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_alert
ON connector_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_delivery_event
ON connector_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_status
ON connector_deliveries (status);

CREATE INDEX IF NOT EXISTS idx_delivery_next_retry
ON connector_deliveries (next_retry_at)
WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_correlation
ON connector_deliveries (correlation_id);

CREATE INDEX IF NOT EXISTS idx_delivery_created
ON connector_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_lookup
ON connector_deliveries (connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_payload_gin
ON connector_deliveries
USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_delivery_response_gin
ON connector_deliveries
USING GIN (provider_response);

-- ============================================================================
-- connector_delivery_attempts
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_attempt_delivery
ON connector_delivery_attempts (delivery_id);

CREATE INDEX IF NOT EXISTS idx_attempt_status
ON connector_delivery_attempts (status);

CREATE INDEX IF NOT EXISTS idx_attempt_time
ON connector_delivery_attempts (attempted_at DESC);

-- ============================================================================
-- connector_health_checks
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_health_connector_recent
ON connector_health_checks (connector_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_status
ON connector_health_checks (status);

CREATE INDEX IF NOT EXISTS idx_health_checked_at
ON connector_health_checks (checked_at DESC);

-- ============================================================================
-- connector_test_runs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_test_connector
ON connector_test_runs (connector_id);

CREATE INDEX IF NOT EXISTS idx_test_created
ON connector_test_runs (created_at DESC);

-- ============================================================================
-- connector_oauth_states
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_state
ON connector_oauth_states (state);

CREATE INDEX IF NOT EXISTS idx_oauth_expiry
ON connector_oauth_states (expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_connector
ON connector_oauth_states (connector_id);

-- ============================================================================
-- connector_audit_logs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_org_created
ON connector_audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_connector_created
ON connector_audit_logs (connector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
ON connector_audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_request
ON connector_audit_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_audit_changes_gin
ON connector_audit_logs
USING GIN (changes_summary);

COMMIT;
