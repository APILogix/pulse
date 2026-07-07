BEGIN;

DO $$
DECLARE
  evt TEXT;
  event_tables TEXT[] := ARRAY[
    'events_errors',
    'events_requests',
    'events_spans',
    'events_metrics'
  ];
  has_timescale BOOLEAN := FALSE;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    has_timescale := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB extension unavailable (%) - events_* remain plain tables', SQLERRM;
  END;

  IF has_timescale THEN
    FOREACH evt IN ARRAY event_tables LOOP
      BEGIN
        PERFORM create_hypertable(evt, 'created_at',
          chunk_time_interval => INTERVAL '1 day',
          if_not_exists => TRUE);
        PERFORM add_retention_policy(evt, INTERVAL '90 days', if_not_exists => TRUE);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB hypertable setup skipped for % (%)', evt, SQLERRM;
      END;
    END LOOP;
  END IF;
END $$;

COMMIT;
