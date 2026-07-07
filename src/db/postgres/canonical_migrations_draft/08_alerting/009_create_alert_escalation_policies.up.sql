BEGIN;

CREATE TABLE IF NOT EXISTS alert_escalation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  repeat_interval_minutes INTEGER,
  max_repeats INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_policy_name_per_org
  ON alert_escalation_policies(organization_id, lower(name))
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_alert_escalation_policies_updated_at ON alert_escalation_policies;
CREATE TRIGGER trg_alert_escalation_policies_updated_at
  BEFORE UPDATE ON alert_escalation_policies
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
