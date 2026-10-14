-- Shared idempotency reservation table across alert workers
CREATE TABLE IF NOT EXISTS alert_runtime_idempotency_keys (
  organization_id       UUID NOT NULL,
  namespace             VARCHAR(64) NOT NULL DEFAULT 'notification_job',
  idempotency_key       VARCHAR(255) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (organization_id, namespace, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_runtime_idempotency_created
  ON alert_runtime_idempotency_keys (created_at);
