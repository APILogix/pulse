-- Connector operational audit event stream (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS connector_audit_logs_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID,
  action                VARCHAR(64) NOT NULL,
  actor_type            VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_user_id         UUID,
  previous_state        JSONB,
  new_state             JSONB,
  changes_summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address            INET,
  user_agent            TEXT,
  request_id            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_v2_default PARTITION OF connector_audit_logs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_action
  ON connector_audit_logs_v2 (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_connector
  ON connector_audit_logs_v2 (connector_id, created_at DESC)
  WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_org
  ON connector_audit_logs_v2 (organization_id, created_at DESC);

