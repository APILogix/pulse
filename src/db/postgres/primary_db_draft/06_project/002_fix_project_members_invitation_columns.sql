-- Repair project_members for draft databases created before invitation audit
-- columns were folded into the normalized table definition.
-- Required by project member invitation flows and ProjectService.ensureProjectOwner,
-- which sets invited_by, invited_at, and joined_at when creating owner memberships.


ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS invited_by UUID,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();

UPDATE project_members
SET
  invited_by = COALESCE(invited_by, added_by_user_id),
  invited_at = COALESCE(invited_at, added_at),
  joined_at = COALESCE(joined_at, added_at, created_at, NOW())
WHERE invited_by IS NULL
   OR invited_at IS NULL
   OR joined_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'project_members'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (invited_by)%'
  ) THEN
    ALTER TABLE project_members
      ADD CONSTRAINT fk_project_members_invited_by
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
