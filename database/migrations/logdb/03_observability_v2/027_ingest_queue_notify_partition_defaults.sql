BEGIN;

-- ============================================================================
-- pg-boss ingest queue latency defaults
--
-- New queue creation now requests partition=true and notify=true. Existing
-- queues cannot safely change partitioning through pg-boss while jobs may be
-- present, but enabling notify is safe and lets producers wake workers without
-- waiting for the next polling interval when LISTEN/NOTIFY is available.
-- ============================================================================

DO $$
DECLARE
  q text;
BEGIN
  IF to_regclass('pgboss.queue') IS NULL THEN
    RETURN;
  END IF;

  FOREACH q IN ARRAY ARRAY[
    'ingest.error',
    'ingest.message',
    'ingest.request',
    'ingest.span',
    'ingest.trace',
    'ingest.metric',
    'ingest.log',
    'ingest.profile',
    'ingest.cron_checkin',
    'ingest.replay',
    'ingest.dlq-intake'
  ] LOOP
    UPDATE pgboss.queue
       SET notify = true,
           updated_on = now()
     WHERE name = q;

    IF EXISTS (
      SELECT 1
      FROM pgboss.queue
      WHERE name = q
        AND partition = false
    ) THEN
      RAISE NOTICE 'pg-boss ingest queue % is not partitioned. Drain and recreate this queue, or rebuild it during a maintenance window, to isolate it from pgboss.job_common.', q;
    END IF;
  END LOOP;
END $$;

COMMIT;
