-- Deliberately safe rollback boundary.
-- This bootstrap consolidates an existing final state. Reversing it automatically
-- could discard application data or conflict with an external migration ledger.
DO $$
BEGIN
  RAISE EXCEPTION 'No automatic rollback is provided for primarydbv2 bootstrap; use lifecycle/drop_all.sql only after confirming the target schema and backup policy.';
END $$;
