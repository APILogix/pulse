BEGIN;

CREATE TABLE IF NOT EXISTS alert_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action history_action NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL DEFAULT 'user',
  previous_state JSONB,
  new_state JSONB,
  changes_summary JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_history_event
  ON alert_event_history(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_org
  ON alert_event_history(organization_id, created_at DESC);

COMMIT;
