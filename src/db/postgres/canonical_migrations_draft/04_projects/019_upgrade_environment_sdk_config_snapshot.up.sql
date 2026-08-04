BEGIN;

-- Structural bridge for databases that applied the pre-breaking SDK schema.
-- Fresh installs already have these final columns from migration 015.
ALTER TABLE project_environment_sdk_config_revisions
  ADD COLUMN IF NOT EXISTS requested_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compiled_snapshot JSONB;

ALTER TABLE project_environment_sdk_config_revisions
  DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

-- Existing installations may still have config_value. Preserve it exactly once
-- as migration input; migration 025 extracts supported editable intent and
-- regenerates every complete snapshot with the strict compiler contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'project_environment_sdk_config_revisions'
       AND column_name = 'config_value'
  ) THEN
    EXECUTE $sql$
      UPDATE project_environment_sdk_config_revisions
         SET compiled_snapshot = config_value
       WHERE compiled_snapshot IS NULL
    $sql$;
    EXECUTE 'ALTER TABLE project_environment_sdk_config_revisions DROP COLUMN config_value';
  END IF;
END $$;

-- Any structurally incomplete historical row is intentionally represented as
-- an empty migration input. Migration 025 recompiles it to canonical defaults.
UPDATE project_environment_sdk_config_revisions
   SET compiled_snapshot = '{}'::jsonb
 WHERE compiled_snapshot IS NULL;

ALTER TABLE project_environment_sdk_config_revisions
  ALTER COLUMN compiled_snapshot SET NOT NULL;

ALTER TABLE project_environment_sdk_config_revisions
  DROP CONSTRAINT IF EXISTS sdk_revisions_requested_config_object,
  DROP CONSTRAINT IF EXISTS sdk_revisions_compiled_snapshot_object;
ALTER TABLE project_environment_sdk_config_revisions
  ADD CONSTRAINT sdk_revisions_requested_config_object
    CHECK (jsonb_typeof(requested_config) = 'object'),
  ADD CONSTRAINT sdk_revisions_compiled_snapshot_object
    CHECK (jsonb_typeof(compiled_snapshot) = 'object');

ALTER TABLE project_environment_sdk_config_revisions
  ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

COMMENT ON COLUMN project_environment_sdk_config_revisions.compiled_snapshot IS
  'Sole authoritative store of the complete immutable schema-v1 SDK document.';
COMMENT ON COLUMN project_environment_sdk_config_revisions.requested_config IS
  'Editable allowlisted project intent only; never the full compiled document.';

COMMIT;
