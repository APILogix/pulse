-- End-user personal notification channel routing preferences
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  user_id               UUID NOT NULL,
  channel_kind          notification_channel_kind NOT NULL,
  destination           VARCHAR(255) NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, channel_kind)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_active
  ON user_notification_preferences (organization_id, user_id, enabled);
