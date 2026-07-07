BEGIN;

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

DROP TRIGGER IF EXISTS trg_alert_events_updated_at ON alert_events;
CREATE TRIGGER trg_alert_events_updated_at
  BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
