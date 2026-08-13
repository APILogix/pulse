-- Normalized final definition for usage_daily_counters.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/011_usage_daily_counters.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  project_id UUID
  REFERENCES projects(id)
  ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  events_count           BIGINT NOT NULL DEFAULT 0,
  ai_credits_used        BIGINT NOT NULL DEFAULT 0,
  requests_count         BIGINT NOT NULL DEFAULT 0,
  errors_count           BIGINT NOT NULL DEFAULT 0,
  traces_count           BIGINT NOT NULL DEFAULT 0,
  spans_count            BIGINT NOT NULL DEFAULT 0,
  metrics_count          BIGINT NOT NULL DEFAULT 0,
  logs_count             BIGINT NOT NULL DEFAULT 0,
  profiles_count         BIGINT NOT NULL DEFAULT 0,
  replays_count          BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_notifications_count BIGINT NOT NULL DEFAULT 0,
  connector_sends_count BIGINT NOT NULL DEFAULT 0,
  email_sends_count BIGINT NOT NULL DEFAULT 0,
  slack_sends_count BIGINT NOT NULL DEFAULT 0,
  sms_sends_count BIGINT NOT NULL DEFAULT 0,
  webhook_sends_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id, usage_date),
  CONSTRAINT uq_usage_scope UNIQUE
  (
  organization_id,
  project_id,
  usage_date
  )
)
PARTITION BY RANGE (usage_date);
