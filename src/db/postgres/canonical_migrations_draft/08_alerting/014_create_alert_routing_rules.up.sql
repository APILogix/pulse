BEGIN;

CREATE TABLE IF NOT EXISTS alert_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_connector_ids UUID[] NOT NULL DEFAULT '{}',
  target_route_ids UUID[] NOT NULL DEFAULT '{}',
  fallback_connector_ids UUID[] NOT NULL DEFAULT '{}',
  template_id UUID REFERENCES alert_templates(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_routing_rule_name_per_org
  ON alert_routing_rules(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_active
  ON alert_routing_rules(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;

DROP TRIGGER IF EXISTS trg_alert_routing_rules_updated_at ON alert_routing_rules;
CREATE TRIGGER trg_alert_routing_rules_updated_at
  BEFORE UPDATE ON alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
