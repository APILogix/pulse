-- Active/firing alert instance state machine (unpartitioned hot state)
CREATE TABLE IF NOT EXISTS alert_event_state (
  alert_key             VARCHAR(512) PRIMARY KEY,
  organization_id       UUID NOT NULL,
  project_id            UUID,
  environment           TEXT,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  fingerprint           VARCHAR(255) NOT NULL,
  state                 alert_state NOT NULL DEFAULT 'firing',
  current_severity      logdb_severity NOT NULL,
  latest_event_id       UUID NOT NULL,
  latest_event_created_at TIMESTAMPTZ NOT NULL,
  firing_started_at     TIMESTAMPTZ NOT NULL,
  last_fired_at         TIMESTAMPTZ NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL,
  resolved_at           TIMESTAMPTZ,
  auto_resolve_at       TIMESTAMPTZ,
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID,
  acknowledgment_expires_at TIMESTAMPTZ,
  suppressed_at         TIMESTAMPTZ,
  silenced_until        TIMESTAMPTZ,
  silenced_by           UUID,
  duplicate_count       INTEGER NOT NULL DEFAULT 0,
  escalation_step       INTEGER NOT NULL DEFAULT 0,
  next_escalation_at    TIMESTAMPTZ,
  incident_id           UUID,
  payload_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_state_active
  ON alert_event_state (organization_id, state, last_seen_at DESC)
  WHERE state IN ('pending','firing','acknowledged');
CREATE INDEX IF NOT EXISTS idx_alert_event_state_escalation
  ON alert_event_state (next_escalation_at)
  WHERE state = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_autoresolve
  ON alert_event_state (auto_resolve_at)
  WHERE state = 'firing' AND auto_resolve_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_ack_expiry
  ON alert_event_state (acknowledgment_expires_at)
  WHERE state = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_incident
  ON alert_event_state (incident_id)
  WHERE incident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_latest_event
  ON alert_event_state (latest_event_id);
