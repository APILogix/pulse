-- Legacy connector runtime table connector_audit_logs (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS connector_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  connector_id UUID,
  route_id UUID,
  status logdb_delivery_status,
  event_type TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  latency_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_default PARTITION OF connector_audit_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_connector_time ON connector_audit_logs (organization_id, connector_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_status_time ON connector_audit_logs (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_request_gin ON connector_audit_logs USING GIN (request_payload);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_occurred_brin ON connector_audit_logs USING BRIN (occurred_at);
