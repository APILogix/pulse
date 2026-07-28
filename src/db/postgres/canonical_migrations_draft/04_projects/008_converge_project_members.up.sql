BEGIN;

-- Forward repair for databases created from the superseded member shape.
-- Fresh installs already have these exact baseline columns.
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS invited_by UUID,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_members'
      AND column_name='added_by_user_id'
  ) THEN
    EXECUTE 'UPDATE project_members
             SET invited_by=COALESCE(invited_by,added_by_user_id)
             WHERE invited_by IS NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_members'
      AND column_name='added_at'
  ) THEN
    EXECUTE 'UPDATE project_members
             SET invited_at=COALESCE(invited_at,added_at),
                 joined_at=COALESCE(joined_at,added_at,NOW())';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='project_members'::regclass AND c.contype='f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (invited_by)%'
  ) THEN
    ALTER TABLE project_members
      ADD CONSTRAINT fk_project_members_invited_by
      FOREIGN KEY(invited_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Direct membership uses built-in roles only; no invitation/custom-role model.
DROP TABLE IF EXISTS project_member_invitations CASCADE;
DROP TABLE IF EXISTS project_roles CASCADE;
DROP TYPE IF EXISTS project_invitation_status;

COMMIT;
