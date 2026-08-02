-- 014_normalize_spans.sql
-- Safely migrates redundant/misnamed span columns and establishes the canonical schema.

BEGIN;

-- 0. Ensure canonical columns exist (they might be missing in older setups)
ALTER TABLE events_spans 
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS span_type TEXT,
  ADD COLUMN IF NOT EXISTS span_status TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT;

-- 1. Safely migrate existing `status_message` data into the canonical `message` column
UPDATE events_spans 
SET message = status_message 
WHERE message IS NULL AND status_message IS NOT NULL;

-- 2. Drop duplicate/redundant columns
ALTER TABLE events_spans 
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS status_message;

-- 3. Create the missing recommended BTREE index on span_kind
CREATE INDEX IF NOT EXISTS idx_events_spans_span_kind_time 
  ON events_spans(organization_id, project_id, span_kind, occurred_at DESC);

COMMIT;
