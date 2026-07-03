-- ============================================================================
-- 002_connectors_create_notification_schema.up.sql
-- ----------------------------------------------------------------------------
-- Enterprise notification connector system.
--
-- Single, idempotent, safe-to-run-on-fresh-DB snapshot of the connector
-- schema. Depends only on `organizations(id)` and `users(id)` from the auth /
-- org schema (migrations2/001 + orgtables.sql).
--
-- Design notes that differ from the original spec:
--   * RLS (ROW LEVEL SECURITY) is NOT enabled. This codebase performs tenant
--     isolation in the SERVICE layer (see modules/.../requireorg.ts,
--     shared/middleware/tenant.ts) and never executes `SET app.current_org_id`.
--     Enabling the spec's RLS policies would filter every row to zero for the
--     normal pool role and break the feature. The intended policies are kept
--     at the bottom of this file, commented out, with instructions for teams
--     that adopt a per-request GUC later.
--   * `set_updated_at()` (defined in orgtables.sql) is reused when present;
--     a local `connector_set_updated_at()` is created defensively so this file
--     is runnable standalone on a fresh DB.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUM types (idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type') THEN
    CREATE TYPE connector_type AS ENUM (
      'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'email', 'sms'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_status') THEN
    CREATE TYPE connector_status AS ENUM (
      'active', 'inactive', 'error', 'pending_setup'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
    CREATE TYPE notification_severity AS ENUM (
      'info', 'warning', 'error', 'critical'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM (
      'pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Shared updated_at trigger function (reuse if present, else create local)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION connector_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3) connector_configs â€” organization-scoped connector configurations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,

    -- Connector metadata
    name VARCHAR(255) NOT NULL,
    type connector_type NOT NULL,
    status connector_status NOT NULL DEFAULT 'pending_setup',
    description TEXT,

    -- Encrypted configuration (AES-256-GCM ciphertext stored as bytea).
    -- Contains: webhook_url, api_key, channel, smtp creds, etc.
    encrypted_config BYTEA NOT NULL,
    config_schema_version INTEGER NOT NULL DEFAULT 1,

    -- Display settings (non-sensitive, safe to return to clients)
    display_config JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Capabilities
    supports_rich_formatting BOOLEAN NOT NULL DEFAULT false,
    supports_threading BOOLEAN NOT NULL DEFAULT false,
    supports_attachments BOOLEAN NOT NULL DEFAULT false,

    -- Per-connector rate limiting
    rate_limit_requests INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_requests > 0),
    rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_window_seconds > 0),

    -- Retry configuration (exponential backoff)
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
    retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000 CHECK (retry_backoff_base_ms >= 0),
    retry_backoff_multiplier NUMERIC NOT NULL DEFAULT 2.0 CHECK (retry_backoff_multiplier >= 1),

    -- Health monitoring
    last_health_check_at TIMESTAMPTZ,
    last_successful_delivery_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    failure_threshold INTEGER NOT NULL DEFAULT 5 CHECK (failure_threshold > 0),

    -- Misc metadata
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Audit timestamps + soft delete
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Name unique per org among non-deleted connectors. Partial unique index is
-- used instead of a UNIQUE constraint on (org, name, deleted_at) because the
-- latter still allows duplicate live names (NULL != NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_per_org
  ON connector_configs(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_connector_configs_org
  ON connector_configs(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_configs_type
  ON connector_configs(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_configs_status
  ON connector_configs(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_connector_configs_updated_at ON connector_configs;
CREATE TRIGGER trg_connector_configs_updated_at
  BEFORE UPDATE ON connector_configs
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) connector_secrets â€” OAuth tokens, refresh tokens, rotating secrets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,

    -- 'oauth_token' | 'refresh_token' | 'api_key' | 'webhook_secret' | 'signing_secret'
    secret_type VARCHAR(50) NOT NULL,
    encrypted_value BYTEA NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_secret_type_per_connector UNIQUE (connector_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_connector_secrets_connector
  ON connector_secrets(connector_id);

DROP TRIGGER IF EXISTS trg_connector_secrets_updated_at ON connector_secrets;
CREATE TRIGGER trg_connector_secrets_updated_at
  BEFORE UPDATE ON connector_secrets
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5) notification_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,

    name VARCHAR(255) NOT NULL,
    connector_type connector_type NOT NULL,
    -- 'markdown' | 'html' | 'json' | 'adaptive_card' | 'text'
    template_format VARCHAR(50) NOT NULL DEFAULT 'markdown',

    subject_template TEXT,
    body_template TEXT NOT NULL,
    variables JSONB NOT NULL DEFAULT '[]'::jsonb,

    is_default BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_name_per_org
  ON notification_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_templates_org_type
  ON notification_templates(organization_id, connector_type) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) notification_routes â€” routing rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,

    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Matching conditions
    event_types VARCHAR(100)[] NOT NULL DEFAULT '{}',
    severity_levels notification_severity[] NOT NULL DEFAULT '{}',
    source_services VARCHAR(100)[] NOT NULL DEFAULT '{}',

    -- Targets (route can fan out to multiple connectors)
    target_connector_ids UUID[] NOT NULL,

    -- Priority + throttling
    priority INTEGER NOT NULL DEFAULT 100,
    throttle_window_seconds INTEGER,
    max_notifications_per_window INTEGER,

    is_active BOOLEAN NOT NULL DEFAULT true,
    schedule JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_name_per_org
  ON notification_routes(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_org_active
  ON notification_routes(organization_id, priority DESC) WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_notification_routes_updated_at ON notification_routes;
CREATE TRIGGER trg_notification_routes_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 7) notification_deliveries â€” delivery attempt log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL,
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
    route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,

    notification_type VARCHAR(100) NOT NULL,
    severity notification_severity NOT NULL,
    payload JSONB NOT NULL,
    payload_size_bytes INTEGER,

    status delivery_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,

    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,

    external_message_id VARCHAR(255),
    response_body TEXT,
    response_status_code INTEGER,
    error_message TEXT,
    error_details JSONB,

    next_retry_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,

    delivery_latency_ms INTEGER,

    correlation_id UUID NOT NULL,
    parent_delivery_id UUID REFERENCES notification_deliveries(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_org_created
  ON notification_deliveries(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_connector
  ON notification_deliveries(connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_status
  ON notification_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_deliveries_correlation
  ON notification_deliveries(correlation_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_next_retry
  ON notification_deliveries(next_retry_at) WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_deliveries_scheduled
  ON notification_deliveries(scheduled_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_notification_deliveries_updated_at ON notification_deliveries;
CREATE TRIGGER trg_notification_deliveries_updated_at
  BEFORE UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 8) notification_dead_letter â€” unrecoverable failures
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_dead_letter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    original_delivery_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    connector_id UUID NOT NULL,

    failure_reason TEXT NOT NULL,
    -- 'timeout' | 'auth_error' | 'rate_limit' | 'invalid_config' | 'unknown'
    failure_category VARCHAR(50) NOT NULL,
    error_stack TEXT,

    original_payload JSONB NOT NULL,

    resolved_at TIMESTAMPTZ,
    resolution_action VARCHAR(50),
    resolved_by UUID REFERENCES users(id),

    retry_attempts INTEGER NOT NULL DEFAULT 0,
    last_retry_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_org
  ON notification_dead_letter(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_connector
  ON notification_dead_letter(connector_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_unresolved
  ON notification_dead_letter(created_at) WHERE resolved_at IS NULL;

DROP TRIGGER IF EXISTS trg_notification_dead_letter_updated_at ON notification_dead_letter;
CREATE TRIGGER trg_notification_dead_letter_updated_at
  BEFORE UPDATE ON notification_dead_letter
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ----------------------------------------------------------------------------
-- 9) connector_health_checks â€” heartbeat history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,

    -- 'healthy' | 'degraded' | 'unhealthy'
    status VARCHAR(20) NOT NULL,
    response_time_ms INTEGER,
    error_message TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_connector
  ON connector_health_checks(connector_id, checked_at DESC);

-- ----------------------------------------------------------------------------
-- 10) connector_audit_logs â€” connector-scoped audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,

    -- 'created' | 'updated' | 'deleted' | 'tested' | 'enabled' | 'disabled' | 'sent' | 'rotated'
    action VARCHAR(50) NOT NULL,
    actor_id UUID,
    actor_type VARCHAR(50) NOT NULL DEFAULT 'user',

    previous_state JSONB,
    new_state JSONB,
    changes_summary JSONB,

    ip_address INET,
    user_agent TEXT,
    request_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_org
  ON connector_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_connector
  ON connector_audit_logs(connector_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 10.1) Foreign keys that may depend on later migrations
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_connector_configs_organization') THEN
      ALTER TABLE connector_configs
        ADD CONSTRAINT fk_connector_configs_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_templates_organization') THEN
      ALTER TABLE notification_templates
        ADD CONSTRAINT fk_notification_templates_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_routes_organization') THEN
      ALTER TABLE notification_routes
        ADD CONSTRAINT fk_notification_routes_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_deliveries_organization') THEN
      ALTER TABLE notification_deliveries
        ADD CONSTRAINT fk_notification_deliveries_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_organization') THEN
      ALTER TABLE notification_dead_letter
        ADD CONSTRAINT fk_notification_dead_letter_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_connector_audit_logs_organization') THEN
      ALTER TABLE connector_audit_logs
        ADD CONSTRAINT fk_connector_audit_logs_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_delivery') THEN
    ALTER TABLE notification_dead_letter
      ADD CONSTRAINT fk_notification_dead_letter_delivery
      FOREIGN KEY (original_delivery_id) REFERENCES notification_deliveries(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_dead_letter_connector') THEN
    ALTER TABLE notification_dead_letter
      ADD CONSTRAINT fk_notification_dead_letter_connector
      FOREIGN KEY (connector_id) REFERENCES connector_configs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 11) COMMENTS
-- ----------------------------------------------------------------------------
COMMENT ON TABLE connector_configs IS 'Organization-scoped connector configurations; credentials encrypted in encrypted_config (AES-256-GCM).';
COMMENT ON TABLE connector_secrets IS 'Encrypted, rotatable secrets (OAuth/refresh tokens, signing secrets) per connector.';
COMMENT ON TABLE notification_templates IS 'Reusable notification templates per connector type.';
COMMENT ON TABLE notification_routes IS 'Routing rules directing events to connectors by type/severity/source.';
COMMENT ON TABLE notification_deliveries IS 'Append-mostly log of every notification delivery attempt.';
COMMENT ON TABLE notification_dead_letter IS 'Notifications that exhausted retries and require operator attention.';
COMMENT ON TABLE connector_health_checks IS 'Historical health/heartbeat results per connector.';
COMMENT ON TABLE connector_audit_logs IS 'Audit trail for connector lifecycle operations.';

-- ----------------------------------------------------------------------------
-- 12) ROW LEVEL SECURITY (INTENTIONALLY DISABLED)
-- ----------------------------------------------------------------------------
-- This codebase isolates tenants in the service layer and does NOT set a
-- per-request `app.current_org_id` GUC. Enabling the policies below without
-- that GUC would return zero rows for every query and break the feature.
--
-- To adopt DB-enforced isolation later: (1) have the request lifecycle run
-- `SELECT set_config('app.current_org_id', $orgId, true)` on the connection
-- it will use, and (2) uncomment the block below.
--
-- ALTER TABLE connector_configs        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE connector_secrets        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_templates   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_routes      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_deliveries  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notification_dead_letter ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE connector_health_checks  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE connector_audit_logs     ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY org_isolation_connector_configs ON connector_configs
--   USING (organization_id = current_setting('app.current_org_id', true)::UUID);
-- ... (analogous policies for the remaining tables) ...

COMMIT;

