BEGIN;

-- Drop legacy/duplicate columns from events_errors
-- As per the new canonical mapping, attributes should hold flexible custom data
-- and contexts, tags, user info, etc.

ALTER TABLE events_errors
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS extra,
  DROP COLUMN IF EXISTS user_email,
  DROP COLUMN IF EXISTS user_ip,
  DROP COLUMN IF EXISTS stack_hash,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS source_context;

-- Note: contexts, breadcrumbs, stack_frames are retained as they are part of canonical mapping.
-- Note: endpoint, status_code, duration_ms already exist on the base tables.
-- Note: name exists on the base tables, error_name on events_errors.
-- We keep name on base tables for other events but use error_name for errors.

ALTER TABLE events_errors
ADD COLUMN IF NOT EXISTS error_group_id UUID;
COMMIT;
