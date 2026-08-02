-- 014_rollback_normalize_spans.sql
-- Rolls back the column normalization and index creation.

BEGIN;

-- 1. Drop the new index
DROP INDEX IF EXISTS idx_events_spans_span_kind_time;

-- 2. Add the redundant columns back
ALTER TABLE events_spans 
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS status_message TEXT;

-- 3. Restore data from canonical columns to legacy columns safely
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events_spans' AND column_name = 'span_kind') THEN
    UPDATE events_spans SET kind = span_kind WHERE kind IS NULL AND span_kind IS NOT NULL;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events_spans' AND column_name = 'span_status') THEN
    UPDATE events_spans SET status = span_status WHERE status IS NULL AND span_status IS NOT NULL;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events_spans' AND column_name = 'message') THEN
    UPDATE events_spans SET status_message = message WHERE status_message IS NULL AND message IS NOT NULL;
  END IF;
END $$;

COMMIT;
