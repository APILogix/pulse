-- Normalized final definition for organization_usage_current_period.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/03_org_identity/001_fixed_tables.sql
-- - canonical_migrations_draft/11_billing/010_organization_usage_current_period.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql
-- - canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql
-- - canonical_migrations_draft/11_billing/newupdatedfix.sql
-- - migrations/004_enterprise_database_integrity.sql

CREATE TABLE IF NOT EXISTS organization_usage_current_period
(
  organization_id UUID PRIMARY KEY
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  events_used              BIGINT NOT NULL DEFAULT 0,
  ai_credits_used          BIGINT NOT NULL DEFAULT 0,
  projects_used            INTEGER NOT NULL DEFAULT 0,
  members_used             INTEGER NOT NULL DEFAULT 0,
  api_keys_used            INTEGER NOT NULL DEFAULT 0,
  connectors_used          INTEGER NOT NULL DEFAULT 0,
  alert_rules_used         INTEGER NOT NULL DEFAULT 0,
  dashboards_used          INTEGER NOT NULL DEFAULT 0,
  event_limit              BIGINT NOT NULL DEFAULT 0,
  ai_credit_limit          BIGINT NOT NULL DEFAULT 0,
  overage_events           BIGINT NOT NULL DEFAULT 0,
  overage_ai_credits       BIGINT NOT NULL DEFAULT 0,
  last_event_at            TIMESTAMPTZ,
  last_ai_request_at       TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  events_count BIGINT NOT NULL DEFAULT 0,
  last_incremented_at TIMESTAMPTZ,
  alert_notifications_used BIGINT NOT NULL DEFAULT 0,
  connector_sends_used BIGINT NOT NULL DEFAULT 0,
  email_sends_used BIGINT NOT NULL DEFAULT 0,
  slack_sends_used BIGINT NOT NULL DEFAULT 0,
  sms_sends_used BIGINT NOT NULL DEFAULT 0,
  webhook_sends_used BIGINT NOT NULL DEFAULT 0,
  last_alert_notification_at TIMESTAMPTZ,
  last_connector_send_at TIMESTAMPTZ,
  projects_limit INTEGER NOT NULL DEFAULT 0,
  members_limit INTEGER NOT NULL DEFAULT 0,
  api_keys_limit INTEGER NOT NULL DEFAULT 0,
  connectors_limit INTEGER NOT NULL DEFAULT 0,
  alert_rules_limit INTEGER NOT NULL DEFAULT 0,
  dashboards_limit INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_usage_period
  CHECK (period_end > period_start),
  CONSTRAINT chk_non_negative
  CHECK (
  events_used >= 0
  AND ai_credits_used >= 0
  AND projects_used >= 0
  AND members_used >= 0
  AND api_keys_used >= 0
  AND connectors_used >= 0
  AND alert_rules_used >= 0
  AND dashboards_used >= 0
  AND event_limit >= 0
  AND ai_credit_limit >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_org_usage_period_end
ON organization_usage_current_period(period_end);

CREATE INDEX IF NOT EXISTS idx_org_usage_subscription
ON organization_usage_current_period(subscription_id);

CREATE INDEX IF NOT EXISTS idx_org_usage_last_event
ON organization_usage_current_period(last_event_at DESC)
WHERE last_event_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_last_ai
ON organization_usage_current_period(last_ai_request_at DESC)
WHERE last_ai_request_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_usage_metadata
ON organization_usage_current_period
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_org_usage_current_period
    ON organization_usage_current_period(organization_id, period_start, period_end);
