BEGIN;

CREATE TABLE IF NOT EXISTS alert_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template_type VARCHAR(50) NOT NULL DEFAULT 'body',
  content TEXT NOT NULL,
  variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_for_severity alert_severity,
  connector_type connector_type,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sample_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_template_name_per_org
  ON alert_templates(organization_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_templates_org
  ON alert_templates(organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_templates_updated_at ON alert_templates;
CREATE TRIGGER trg_alert_templates_updated_at
  BEFORE UPDATE ON alert_templates
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
