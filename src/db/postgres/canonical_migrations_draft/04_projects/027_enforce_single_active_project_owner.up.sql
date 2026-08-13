BEGIN;

-- 1. Safely resolve any pre-existing duplicate active owners per project before creating the index.
-- Keep the most recently updated active owner and demote older duplicate owners to 'admin'.
WITH ranked_owners AS (
  SELECT
    id,
    project_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS rank_num
  FROM project_members
  WHERE role = 'owner' AND status = 'active'
),
duplicate_owners AS (
  SELECT id FROM ranked_owners WHERE rank_num > 1
)
UPDATE project_members
   SET role = 'admin',
       updated_at = NOW()
 WHERE id IN (SELECT id FROM duplicate_owners);

-- 2. Create the PostgreSQL partial unique index guaranteeing at most ONE active owner per project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_single_active_owner
  ON project_members(project_id)
  WHERE role = 'owner' AND status = 'active';

COMMIT;
