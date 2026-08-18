BEGIN;

-- Typed-event contract trigger function.
-- Ensures timestamp/occurred_at/created_at/ingested_at stay synchronized,
-- locks metadata.environment to the environment column, backfills payload
-- from the row when the writer did not supply a raw SDK document, and
-- guarantees that public_id is automatically generated from the appropriate sequence.
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Sync timestamps
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- 2. Lock metadata environment
  NEW.metadata := jsonb_set(
    CASE WHEN jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.metadata, '{}'::jsonb) ELSE '{}'::jsonb END,
    '{environment}', to_jsonb(NEW.environment), true
  );

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
    ELSIF TG_TABLE_NAME LIKE 'analytics_error_groups%' OR TG_TABLE_NAME LIKE 'error_groups%' THEN
      NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'analytics_user_sessions%' THEN
      NEW.public_id := 'SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0');
    END IF;
  END IF;

  -- 4. Fallback payload
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
