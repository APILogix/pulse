BEGIN;

-- The partitioned fact indexes include created_at, so they cannot guarantee
-- cross-partition uniqueness. The non-partitioned idempotency authority is
-- the durable uniqueness boundary for event, notification, and attempt writes.

CREATE OR REPLACE FUNCTION reserve_alert_runtime_idempotency(
  p_namespace VARCHAR,
  p_organization_id UUID,
  p_idempotency_key VARCHAR,
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
  VALUES (p_namespace, p_organization_id, p_idempotency_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

COMMENT ON FUNCTION reserve_alert_runtime_idempotency(VARCHAR, UUID, VARCHAR) IS
  'Reserves a runtime identity independent of partition timestamps; false means duplicate.';

COMMIT;
