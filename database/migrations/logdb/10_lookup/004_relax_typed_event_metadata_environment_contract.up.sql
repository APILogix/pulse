BEGIN;

-- The typed-event trigger keeps metadata.environment equal to the server-
-- resolved environment while preserving SDK metadata keys. The original
-- 10_lookup/003 constraint accidentally required metadata to contain only the
-- environment key, which rejected valid SDK-enriched log rows.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (metadata @> jsonb_build_object(''environment'',environment))',
      t, t || '_metadata_environment_ck'
    );
  END LOOP;
END $$;

COMMIT;
