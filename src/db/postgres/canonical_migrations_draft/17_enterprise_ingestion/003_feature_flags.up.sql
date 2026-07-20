-- =============================================================================
-- Module      : Enterprise Ingestion
-- Migration   : 003_feature_flags.up.sql
-- Description : Centralized feature flag registry.
--
-- Three scopes, evaluated most-specific-wins (project > organization >
-- platform). Used to gate AI alert analysis, experimental pipelines, beta
-- processors and future event types without deploys.
--
-- A CHECK constraint (not an enum) is used for scope so new scopes do not
-- require a type migration; the generator's drop script only tracks enums
-- created via CREATE TYPE ... AS ENUM.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('platform', 'organization', 'project')),
  scope_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_feature_flags_scope_id CHECK (
    (scope = 'platform' AND scope_id IS NULL)
    OR (scope IN ('organization', 'project') AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_key_scope
  ON feature_flags(key, scope, scope_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_feature_flags_scope
  ON feature_flags(scope, scope_id);

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Well-known flags (platform scope, disabled by default; orgs opt in).
INSERT INTO feature_flags (key, scope, scope_id, enabled, description)
VALUES
  ('ai_alert_analysis', 'platform', NULL, FALSE,
   'AI analysis hook between alert generation and notification delivery (extension point, not implemented).'),
  ('experimental_pipelines', 'platform', NULL, FALSE,
   'Enables experimental per-type worker pipelines.'),
  ('beta_processors', 'platform', NULL, FALSE,
   'Enables beta event processors before GA.')
ON CONFLICT DO NOTHING;

COMMIT;
