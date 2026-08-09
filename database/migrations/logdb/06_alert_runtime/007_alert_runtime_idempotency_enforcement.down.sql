BEGIN;

DROP FUNCTION IF EXISTS reserve_alert_runtime_idempotency(VARCHAR, UUID, VARCHAR);

COMMIT;
