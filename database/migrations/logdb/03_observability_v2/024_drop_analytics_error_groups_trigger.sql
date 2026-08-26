BEGIN;

-- Drop trg_sync_error_groups_contract from analytics_error_groups since it does not have a public_id column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
  END IF;
END $$;

COMMIT;
