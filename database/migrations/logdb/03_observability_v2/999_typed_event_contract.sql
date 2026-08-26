BEGIN;

-- Fast typed-event contract trigger function.
-- Keeps direct-SQL safety while avoiding JSONB rewrites on the normal writer
-- path, where occurred_at, metadata.environment, and payload are supplied.
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Sync timestamps without changing writer-provided values.
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- 2. Lock metadata environment, but skip jsonb_set() when already correct.
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

  -- 3. Auto-generate public_id if not present or empty
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  -- 4. Fallback payload for direct SQL inserts and older callers.
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the contract trigger to all canonical typed-event tables.
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
