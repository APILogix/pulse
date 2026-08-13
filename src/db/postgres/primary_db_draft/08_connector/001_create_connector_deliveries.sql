-- Normalized final definition for connector_deliveries.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  route_id UUID REFERENCES connector_routes(id) ON DELETE SET NULL,
  event_id UUID,
  alert_id UUID,
  notification_type VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity VARCHAR(30) NOT NULL DEFAULT 'info',
  status VARCHAR(30) NOT NULL,
  http_status INTEGER,
  provider_request_id VARCHAR(255),
  external_message_id VARCHAR(255),
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  provider_response JSONB,
  response_body TEXT,
  response_status_code INTEGER,
  error_message TEXT,
  error_details JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  duration_ms INTEGER,
  delivery_latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  parent_delivery_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_delivery_connector
ON connector_deliveries (connector_id);

CREATE INDEX IF NOT EXISTS idx_delivery_org_created
ON connector_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_alert
ON connector_deliveries (alert_id);

CREATE INDEX IF NOT EXISTS idx_delivery_event
ON connector_deliveries (event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_status
ON connector_deliveries (status);

CREATE INDEX IF NOT EXISTS idx_delivery_next_retry
ON connector_deliveries (next_retry_at)
WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_correlation
ON connector_deliveries (correlation_id);

CREATE INDEX IF NOT EXISTS idx_delivery_created
ON connector_deliveries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_lookup
ON connector_deliveries (connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_payload_gin
ON connector_deliveries
USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_delivery_response_gin
ON connector_deliveries
USING GIN (provider_response);
