BEGIN;

INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
SELECT DISTINCT 'telemetry_outbox', organization_id, signal_kind || ':' || event_id
  FROM telemetry_outbox
ON CONFLICT DO NOTHING;

COMMENT ON TABLE alert_runtime_idempotency_keys IS
  'Non-partitioned idempotency authority for alert and telemetry runtime facts.';

COMMIT;
