BEGIN;

-- ============================================================================
-- Fix LogDB error_groups trigger contract
-- Removes erroneous typed event trigger (logdb_sync_typed_event_contract)
-- from error_groups and analytics_error_groups, ensuring they only use
-- logdb_sync_error_groups_contract to avoid "no field occurred_at" error (42703).
-- ============================================================================

-- 1. Ensure error_groups public ID sequence exists
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START 1;

-- 2. Drop the typed-event trigger from non-typed event tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON error_groups;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON analytics_error_groups;
  END IF;
END $$;

-- 3. Ensure dedicated error groups contract function exists and assigns ISS-... public_id
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach dedicated error groups trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract
      BEFORE INSERT OR UPDATE ON error_groups
      FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract
      BEFORE INSERT OR UPDATE ON analytics_error_groups
      FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;
END $$;

-- 5. Re-apply typed-event trigger ONLY to actual typed event tables
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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
        t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
