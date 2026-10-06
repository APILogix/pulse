-- Audit history for error_group changes (status, merge, regression, etc.).
CREATE TABLE IF NOT EXISTS error_group_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_status VARCHAR(32),
  new_status VARCHAR(32),
  event_id VARCHAR(64),
  release VARCHAR(100),
  occurred_at TIMESTAMPTZ,
  reason TEXT,
  actor_type VARCHAR(32),
  source_group_id UUID,
  target_group_id UUID
);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_id
  ON error_group_history (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_group_created_v2
  ON error_group_history (group_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_error_group_history_event_v2
  ON error_group_history (event_id)
  WHERE event_id IS NOT NULL;
