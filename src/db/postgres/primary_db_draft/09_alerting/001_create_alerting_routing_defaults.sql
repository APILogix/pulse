-- Normalized final definition for alerting_routing_defaults.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql
-- - migrations/002_create_all_ordered.sql

CREATE TABLE IF NOT EXISTS alerting_routing_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  destination_type VARCHAR(30) NOT NULL CHECK (destination_type IN ('email', 'dashboard', 'none')),
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_routing_default UNIQUE (organization_id, severity, priority),
  CONSTRAINT ck_alerting_routing_default_config CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_routing_defaults_org_severity
  ON alerting_routing_defaults(organization_id, severity, priority);
