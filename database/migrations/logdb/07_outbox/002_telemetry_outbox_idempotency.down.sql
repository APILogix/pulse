BEGIN;
DELETE FROM alert_runtime_idempotency_keys
 WHERE namespace = 'telemetry_outbox';
COMMIT;
