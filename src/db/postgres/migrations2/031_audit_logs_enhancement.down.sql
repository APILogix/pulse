BEGIN;
ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS organization_id,
    DROP COLUMN IF EXISTS project_id,
    DROP COLUMN IF EXISTS actor_id,
    DROP COLUMN IF EXISTS actor_type,
    DROP COLUMN IF EXISTS resource_type,
    DROP COLUMN IF EXISTS resource_id,
    DROP COLUMN IF EXISTS payload;
COMMIT;
