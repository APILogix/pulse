-- ============================================================================
-- Migration: 022_add_project_public_id
-- Purpose:   Introduce an immutable public-facing identifier for every project.
--            The format is prj_XXXXXXXX (8 URL-safe uppercase alphanumeric chars).
--            Internal UUIDs remain the primary key and are never removed.
--
-- Idempotent: Yes — safe to run multiple times.
-- ============================================================================

-- 1. Add the column as nullable first so we can backfill without locking.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS public_id TEXT;

-- 2. Backfill all existing rows that are missing a public_id.
--    Uses gen_random_uuid() for entropy, then strips dashes and takes 8 chars.
--    In the extremely unlikely event of a collision this will be caught by the
--    UNIQUE constraint added below and the migration can be re-run.
UPDATE projects
SET public_id = 'prj_' || upper(
  substring(
    replace(gen_random_uuid()::text, '-', ''),
    1, 8
  )
)
WHERE public_id IS NULL;

-- 3. Now that every row has a value, enforce NOT NULL.
ALTER TABLE projects
  ALTER COLUMN public_id SET NOT NULL;

-- 4. Unique constraint (also creates the unique index).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_public_id_unique'
      AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_public_id_unique UNIQUE (public_id);
  END IF;
END
$$;

-- 5. Separate btree index for fast lookups by public_id.
CREATE INDEX IF NOT EXISTS idx_projects_public_id ON projects (public_id);

-- 6. Immutability trigger — prevents any UPDATE from changing public_id.
CREATE OR REPLACE FUNCTION fn_prevent_project_public_id_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.public_id IS DISTINCT FROM NEW.public_id THEN
    RAISE EXCEPTION
      'projects.public_id is immutable. Attempted change from "%" to "%".',
      OLD.public_id, NEW.public_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_public_id_immutable ON projects;
CREATE TRIGGER trg_projects_public_id_immutable
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_project_public_id_update();

-- 7. Comment for schema introspection tools.
COMMENT ON COLUMN projects.public_id IS
  'Immutable, URL-safe public identifier in the format prj_XXXXXXXX. '
  'Used in browser routing instead of the internal UUID. '
  'Never editable after creation.';
