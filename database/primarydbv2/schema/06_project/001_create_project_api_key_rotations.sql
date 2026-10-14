-- Normalized final definition for project_api_key_rotations.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql

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

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_tenant_time
  ON project_api_key_rotations(organization_id,project_id,environment_id,initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_old_key
  ON project_api_key_rotations(old_key_id,initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_grace_lookup
  ON project_api_key_rotations(old_key_id,grace_ends_at DESC)
  WHERE state = 'grace_period' AND grace_ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_new_key
  ON project_api_key_rotations(new_key_id) WHERE new_key_id IS NOT NULL;
