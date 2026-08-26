BEGIN;

-- ============================================================================
-- Fast typed-event contract trigger
--
-- The ingestion writer already supplies occurred_at, metadata.environment, and
-- the raw SDK payload. Keep direct-SQL safety, but avoid rewriting JSONB values
-- on the normal hot path.
-- ============================================================================

CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- Timestamp columns are already supplied by the writer/defaults on the hot
  -- path. These COALESCE checks preserve legacy/direct insert safety without
  -- changing valid writer-provided values.
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- Avoid jsonb_set() and a full JSONB rewrite when metadata.environment is
  -- already correct.
  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

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

  -- The ingestion writer supplies payload. Keep fallback only for direct SQL
  -- inserts and older callers.
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
