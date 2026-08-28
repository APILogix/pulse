BEGIN;

-- Dropping a partitioned-parent index also takes locks. A populated table uses
-- the same explicit drain assertion and short lock wait as the forward path.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  table_has_rows BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM events_logs LIMIT 1)
    INTO table_has_rows;

  IF table_has_rows
     AND COALESCE(
       current_setting('pulse.events_logs_identity_drain_confirmed', true),
       ''
     ) <> 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'events_logs identity rollback requires a confirmed ingestion drain',
      DETAIL = 'The unique index and migration ledger were left unchanged.',
      HINT = 'Stop ingestion producers and workers, drain active writes, then set pulse.events_logs_identity_drain_confirmed=on for this rollback session.';
  END IF;
END
$$;

-- Roll back only the new identity guard. Keep idx_events_logs_event: removal of
-- the existing non-unique lookup index requires separate query-plan evidence.
DROP INDEX IF EXISTS idx_events_logs_event_unique;

-- Down migrations are operator-invoked and excluded by the canonical runner.
-- Remove the exact up-migration ledger entry so a later approved re-apply is
-- not incorrectly skipped.
DELETE FROM logdb_migrations
WHERE filename = '03_observability_v2/030_events_logs_idempotency.up.sql';

COMMIT;
