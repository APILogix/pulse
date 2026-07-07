BEGIN;

CREATE TABLE IF NOT EXISTS alert_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  acknowledged_by UUID NOT NULL REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  comment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_ack_per_event
  ON alert_acknowledgments(event_id)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alert_acks_org
  ON alert_acknowledgments(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_acknowledgments_updated_at ON alert_acknowledgments;
CREATE TRIGGER trg_alert_acknowledgments_updated_at
  BEFORE UPDATE ON alert_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
