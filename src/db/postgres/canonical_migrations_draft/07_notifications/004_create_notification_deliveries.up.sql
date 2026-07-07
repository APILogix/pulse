BEGIN;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
  ON notification_deliveries(status)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_deliveries_correlation
  ON notification_deliveries(correlation_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_next_retry
  ON notification_deliveries(next_retry_at)
  WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_deliveries_scheduled
  ON notification_deliveries(scheduled_at)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_notification_deliveries_updated_at ON notification_deliveries;
CREATE TRIGGER trg_notification_deliveries_updated_at
  BEFORE UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
