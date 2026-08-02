BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS ai_response JSONB', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS application_name TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS application_version TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS server_name TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS request_id TEXT', t);
  END LOOP;
END $$;

-- Keep the original SDK event document in payload and retain the full SDK
-- metadata object. The event table's typed columns are query projections; the
-- JSON document is the lossless compatibility path for SDK fields added later.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN payload SET DEFAULT ''{}''::jsonb', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN metadata SET DEFAULT ''{}''::jsonb', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_metadata_environment_ck');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (ai_response)', 'idx_' || t || '_ai_response_gin', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  NEW.timestamp := COALESCE(NEW.timestamp, NEW.occurred_at, NOW());
  NEW.occurred_at := NEW.timestamp;
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);
  NEW.metadata := jsonb_set(
    CASE WHEN jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.metadata, '{}'::jsonb) ELSE '{}'::jsonb END,
    '{environment}', to_jsonb(NEW.environment), true
  );
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests','events_errors','events_logs','events_metrics','events_spans',
    'events_traces','events_messages','events_profiles','events_replays','events_cron_checkins'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
      t
    );
  END LOOP;
END $$;

COMMIT;
