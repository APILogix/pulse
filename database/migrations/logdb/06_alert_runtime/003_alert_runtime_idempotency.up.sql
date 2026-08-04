BEGIN;

CREATE TABLE IF NOT EXISTS alert_runtime_idempotency_keys (
  namespace       VARCHAR(64) NOT NULL,
  organization_id UUID NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_runtime_idempotency_created
  ON alert_runtime_idempotency_keys (created_at);

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'alert_event', organization_id, idempotency_key
  FROM alert_events_v2
 WHERE idempotency_key IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'notification_job', organization_id, idempotency_key
  FROM alert_notification_jobs
 WHERE idempotency_key IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'delivery_attempt', organization_id,
       notification_job_id::text || ':' || attempt_number::text
  FROM alert_delivery_attempts_v2
ON CONFLICT DO NOTHING;

COMMENT ON TABLE alert_runtime_idempotency_keys IS
  'Non-partitioned idempotency authority for alert runtime facts. Partition timestamps are never part of identity.';

COMMIT;
