-- Primary DB AI hardening only. AI runtime analytics tables moved to database/migrations/logdb/07_ai_runtime.
BEGIN;

ALTER TABLE credit_balances
  ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_owner_idempotency
  ON credit_ledger (owner_type, owner_id, idempotency_key);

CREATE OR REPLACE FUNCTION ai_refund_credit(
  p_owner_id UUID,
  p_request_id TEXT,
  p_idempotency_key TEXT,
  p_ai_mode TEXT,
  p_amount BIGINT,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  original_amount BIGINT;
  refunded_amount BIGINT;
  original_unlimited BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_request_id,0));

  IF EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE owner_type='organization' AND owner_id=p_owner_id AND idempotency_key=p_idempotency_key
  ) THEN RETURN FALSE; END IF;

  SELECT amount,COALESCE((metadata->>'unlimited')::boolean,FALSE)
  INTO original_amount,original_unlimited
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='debit' AND status='completed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF original_amount IS NULL THEN
    RAISE EXCEPTION 'No completed AI debit exists for this refund';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO refunded_amount
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='refund' AND status='completed';

  IF p_amount > original_amount-refunded_amount THEN
    RAISE EXCEPTION 'Refund exceeds remaining refundable AI debit';
  END IF;

  IF NOT original_unlimited THEN
    UPDATE credit_balances
    SET balance=balance+p_amount,version=version+1
    WHERE owner_type='organization' AND owner_id=p_owner_id AND unlimited=FALSE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund credit balance is unavailable'; END IF;
  END IF;

  INSERT INTO credit_ledger
    (owner_type,owner_id,request_id,idempotency_key,ai_mode,amount,direction,reason,status,metadata)
  VALUES
    ('organization',p_owner_id,p_request_id,p_idempotency_key,p_ai_mode,p_amount,'refund',
     LEFT(COALESCE(p_reason,'AI credit refund'),500),'completed',
     jsonb_build_object('original_debit_amount',original_amount,'unlimited',original_unlimited));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item RECORD;
  released INTEGER := 0;
BEGIN
  PERFORM set_config('ai.allow_ledger_mutation','on',true);
  FOR item IN
    SELECT ledger_id,owner_id,amount,(metadata->>'unlimited')::boolean AS unlimited
    FROM credit_ledger
    WHERE direction='debit' AND status='pending' AND created_at < NOW()-INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT COALESCE(item.unlimited,FALSE) THEN
      UPDATE credit_balances
      SET reserved_credits=GREATEST(0,reserved_credits-item.amount),version=version+1
      WHERE owner_type='organization' AND owner_id=item.owner_id;
    END IF;
    UPDATE credit_ledger SET status='failed',reason='Stale reservation automatically released'
    WHERE ledger_id=item.ledger_id;
    released := released+1;
  END LOOP;
  RETURN released;
END;
$$;

REVOKE ALL ON FUNCTION ai_refund_credit(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_release_stale_reservations() FROM PUBLIC;

COMMENT ON FUNCTION ai_refund_credit IS
  'Idempotent backend-only AI credit refund. The model can never invoke this function directly.';
COMMENT ON FUNCTION ai_release_stale_reservations IS
  'Releases reservations abandoned by process crashes without deducting credits.';

COMMIT;
