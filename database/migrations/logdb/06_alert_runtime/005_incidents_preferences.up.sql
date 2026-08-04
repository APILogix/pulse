BEGIN;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','closed')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_state ON alert_incidents (organization_id, state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  channel_kind notification_channel_kind NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  vacation_until TIMESTAMPTZ,
  temporary_mute_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, channel_kind)
);
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_active ON user_notification_preferences (organization_id, user_id, enabled);

CREATE TABLE IF NOT EXISTS alert_correlation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  correlation_key VARCHAR(255) NOT NULL,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, correlation_key)
);

COMMIT;
