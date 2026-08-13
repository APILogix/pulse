BEGIN;

-- Forward-only convergence: ledgered migrations remain immutable. Rotation
-- lifecycle data is externalized before obsolete credential columns are removed.
CREATE TABLE IF NOT EXISTS project_api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE RESTRICT,
  old_key_id UUID NOT NULL,
  new_key_id UUID,
  state api_key_rotation_state NOT NULL DEFAULT 'rotating',
  reason TEXT,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grace_ends_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT project_api_key_rotations_distinct_keys CHECK (new_key_id IS NULL OR new_key_id <> old_key_id),
  CONSTRAINT project_api_key_rotations_state_check CHECK (
    state <> 'none'
    AND (state <> 'grace_period' OR grace_ends_at IS NOT NULL)
    AND (state <> 'completed' OR completed_at IS NOT NULL)
  )
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_api_keys' AND column_name='rotation_state'
  ) THEN
    EXECUTE $sql$
      INSERT INTO project_api_key_rotations(
        organization_id,project_id,environment_id,old_key_id,new_key_id,state,reason,
        initiated_by,initiated_at,grace_ends_at,completed_at
      )
      SELECT n.organization_id,n.project_id,n.environment_id,n.rotated_from_key_id,n.id,
             COALESCE(NULLIF(n.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state),n.rotation_reason,
             COALESCE(n.rotated_by,n.created_by),COALESCE(n.rotated_at,n.created_at),
             n.grace_period_ends_at,
             CASE WHEN COALESCE(NULLIF(n.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state)='completed'
                  THEN COALESCE(n.rotated_at,n.updated_at,n.created_at) END
      FROM project_api_keys n
      JOIN project_api_keys o
        ON o.id=n.rotated_from_key_id
       AND o.project_id=n.project_id
       AND o.organization_id=n.organization_id
       AND o.environment_id=n.environment_id
      WHERE n.rotated_from_key_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM project_api_key_rotations r
          WHERE r.old_key_id=n.rotated_from_key_id AND r.new_key_id=n.id
        )
    $sql$;

    EXECUTE $sql$
      INSERT INTO project_api_key_rotations(
        organization_id,project_id,environment_id,old_key_id,new_key_id,state,reason,
        initiated_by,initiated_at,grace_ends_at,completed_at
      )
      SELECT k.organization_id,k.project_id,k.environment_id,k.id,NULL,
             COALESCE(NULLIF(k.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state),
             k.rotation_reason,k.rotated_by,COALESCE(k.rotated_at,k.updated_at,k.created_at),
             k.grace_period_ends_at,
             CASE WHEN COALESCE(NULLIF(k.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state)='completed'
                  THEN COALESCE(k.rotated_at,k.updated_at,k.created_at) END
      FROM project_api_keys k
      WHERE (k.rotation_state <> 'none' OR k.status='rotated')
        AND NOT EXISTS (SELECT 1 FROM project_api_key_rotations r WHERE r.old_key_id=k.id)
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_tenant_time
  ON project_api_key_rotations(organization_id,project_id,environment_id,initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_old_key
  ON project_api_key_rotations(old_key_id,initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_new_key
  ON project_api_key_rotations(new_key_id) WHERE new_key_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_project_api_keys_composite'
  ) THEN
    ALTER TABLE project_api_keys
      ADD CONSTRAINT uq_project_api_keys_composite UNIQUE (id, project_id, organization_id, environment_id);
  END IF;
END $$;

ALTER TABLE project_api_key_rotations
  DROP CONSTRAINT IF EXISTS fk_project_api_key_rotations_old_key_tenant,
  DROP CONSTRAINT IF EXISTS fk_project_api_key_rotations_new_key_tenant;

ALTER TABLE project_api_key_rotations
  ADD CONSTRAINT fk_project_api_key_rotations_old_key_tenant
  FOREIGN KEY(old_key_id,project_id,organization_id,environment_id)
  REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_api_key_rotations_new_key_tenant
  FOREIGN KEY(new_key_id,project_id,organization_id,environment_id)
  REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE RESTRICT;

ALTER TABLE project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_usage_count_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_rate_limits_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_auto_rotate_days_check;

DO $$
DECLARE obsolete_column TEXT;
BEGIN
  FOR obsolete_column IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_api_keys'
      AND column_name <> ALL(ARRAY[
        'id','organization_id','project_id','environment_id','name','public_key','secret_hash',
        'status','expires_at','last_used_at','created_by','rotated_from_key_id',
        'created_at','updated_at','deleted_at'
      ])
  LOOP
    EXECUTE format('ALTER TABLE project_api_keys DROP COLUMN IF EXISTS %I', obsolete_column);
  END LOOP;
END $$;

ALTER TABLE project_api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_lifecycle_check CHECK (
  (rotated_from_key_id IS NULL OR rotated_from_key_id <> id)
  AND (expires_at IS NULL OR expires_at > created_at)
);
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_public_key_format_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_public_key_format_check CHECK (
  public_key ~ '^(pv_live_|pv_test_)[0-9a-f]{24}$'
  OR public_key ~ '^pulsiv_[A-Za-z0-9_-]+$'
);
DROP TYPE IF EXISTS api_key_type;

COMMENT ON TABLE project_api_key_rotations IS
  'Append-oriented API-key rotation workflow/history; credentials retain only direct rotated_from_key_id lineage.';
COMMENT ON TABLE project_api_keys IS
  'Minimal project credential: tenant/environment identity, public lookup, secret verifier, lifecycle, and direct lineage only.';

-- Usage fact tables and rollup functions moved to database/migrations/logdb/01_usage.

COMMIT;

