-- Normalized final definition for alert_events.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  status alert_event_status NOT NULL DEFAULT 'pending',
  severity alert_severity NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  source VARCHAR(100) NOT NULL,
  source_id VARCHAR(255),
  payload JSONB NOT NULL,
  payload_size_bytes INTEGER,
  normalized_payload JSONB,
  group_id UUID,
  group_key VARCHAR(255),
  is_group_parent BOOLEAN NOT NULL DEFAULT FALSE,
  parent_event_id UUID REFERENCES alert_events(id) ON DELETE SET NULL,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  next_escalation_at TIMESTAMPTZ,
  auto_resolve_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_reason VARCHAR(100),
  suppressed_by UUID REFERENCES users(id),
  suppressed_at TIMESTAMPTZ,
  suppression_reason VARCHAR(255),
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escalation_policy_id UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  escalation_step_number INTEGER NOT NULL DEFAULT 0,
  escalation_repeat_count INTEGER NOT NULL DEFAULT 0,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT valid_event_lifecycle CHECK (
  (status = 'resolved' AND resolved_at IS NOT NULL) OR (status <> 'resolved')
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_events_org_status
  ON alert_events(organization_id, status, created_at DESC)
  WHERE status IN ('firing', 'acknowledged', 'pending');

CREATE INDEX IF NOT EXISTS idx_alert_events_org_rule
  ON alert_events(organization_id, rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint
  ON alert_events(organization_id, fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_source
  ON alert_events(organization_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_group
  ON alert_events(organization_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_next_escalation
  ON alert_events(next_escalation_at)
  WHERE status = 'firing' AND next_escalation_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_auto_resolve
  ON alert_events(auto_resolve_at)
  WHERE status = 'firing' AND auto_resolve_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_pending_claim
  ON alert_events(organization_id, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_alert_events_stuck_processing
  ON alert_events(updated_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_alert_events_expired_ack
  ON alert_events(acknowledgment_expires_at)
  WHERE status = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_escalation_policy
  ON alert_events(escalation_policy_id)
  WHERE escalation_policy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_org_project_status
  ON alert_events(organization_id, project_id, status, created_at DESC);
