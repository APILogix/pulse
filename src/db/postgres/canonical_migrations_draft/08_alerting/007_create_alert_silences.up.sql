BEGIN;

CREATE TABLE IF NOT EXISTS alert_silences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  comment TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  matchers JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_silence_duration CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_alert_silences_active
  ON alert_silences(organization_id, is_active, ends_at)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alert_silences_rule
  ON alert_silences(rule_id, is_active)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_alert_silences_updated_at ON alert_silences;
CREATE TRIGGER trg_alert_silences_updated_at
  BEFORE UPDATE ON alert_silences
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
