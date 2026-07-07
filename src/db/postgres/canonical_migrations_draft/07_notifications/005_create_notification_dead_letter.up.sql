BEGIN;

CREATE TABLE IF NOT EXISTS notification_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_delivery_id UUID NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  failure_reason TEXT NOT NULL,
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
  ON notification_dead_letter(created_at)
  WHERE resolved_at IS NULL;

DROP TRIGGER IF EXISTS trg_notification_dead_letter_updated_at ON notification_dead_letter;
CREATE TRIGGER trg_notification_dead_letter_updated_at
  BEFORE UPDATE ON notification_dead_letter
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
