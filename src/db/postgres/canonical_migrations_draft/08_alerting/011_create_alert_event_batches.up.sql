BEGIN;

CREATE TABLE IF NOT EXISTS alert_event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status batch_status NOT NULL DEFAULT 'pending',
  worker_id VARCHAR(255),
  event_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_batches_status
  ON alert_event_batches(status, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_alert_event_batches_org
  ON alert_event_batches(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_alert_event_batches_updated_at ON alert_event_batches;
CREATE TRIGGER trg_alert_event_batches_updated_at
  BEFORE UPDATE ON alert_event_batches
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
