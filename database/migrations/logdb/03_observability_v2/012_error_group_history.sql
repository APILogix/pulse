BEGIN;

-- Audit history for error_group changes (status, merge, regression, etc.).
CREATE TABLE IF NOT EXISTS error_group_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_id
  ON error_group_history (group_id, created_at DESC);

COMMIT;
