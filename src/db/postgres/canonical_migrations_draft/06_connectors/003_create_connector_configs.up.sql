BEGIN;

CREATE TABLE IF NOT EXISTS connector_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type connector_type NOT NULL,
  status connector_status NOT NULL DEFAULT 'pending_setup',
  description TEXT,
  encrypted_config BYTEA NOT NULL,
  config_schema_version INTEGER NOT NULL DEFAULT 1,
  display_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  supports_rich_formatting BOOLEAN NOT NULL DEFAULT FALSE,
  supports_threading BOOLEAN NOT NULL DEFAULT FALSE,
  supports_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_requests INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_requests > 0),
  rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_window_seconds > 0),
  max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  retry_backoff_base_ms INTEGER NOT NULL DEFAULT 1000 CHECK (retry_backoff_base_ms >= 0),
  retry_backoff_multiplier NUMERIC NOT NULL DEFAULT 2.0 CHECK (retry_backoff_multiplier >= 1),
  last_health_check_at TIMESTAMPTZ,
  last_successful_delivery_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_threshold INTEGER NOT NULL DEFAULT 5 CHECK (failure_threshold > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_name_per_org
  ON connector_configs(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_configs_org
  ON connector_configs(organization_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_configs_type
  ON connector_configs(type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_connector_configs_status
  ON connector_configs(status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_connector_configs_updated_at ON connector_configs;
CREATE TRIGGER trg_connector_configs_updated_at
  BEFORE UPDATE ON connector_configs
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
