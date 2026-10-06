-- Normalized final definition for alert_delivery_attempts.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  route_id UUID REFERENCES notification_routes(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES alert_event_batches(id) ON DELETE SET NULL,
  status delivery_attempt_status NOT NULL DEFAULT 'pending',
  request_payload JSONB,
  request_headers JSONB,
  response_payload TEXT,
  response_status_code INTEGER,
  error_message TEXT,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category VARCHAR(50),
  latency_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  max_retries INTEGER NOT NULL DEFAULT 3,
  external_message_id VARCHAR(255),
  external_delivery_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_event
  ON alert_delivery_attempts(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_connector
  ON alert_delivery_attempts(connector_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_status
  ON alert_delivery_attempts(status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_batch
  ON alert_delivery_attempts(batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_org_created
  ON alert_delivery_attempts(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_event_created
  ON alert_delivery_attempts (event_id, created_at DESC);

