-- Normalized final definition for notification_routes.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/07_notifications/003_create_notification_routes.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS notification_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  event_types VARCHAR(100)[] NOT NULL DEFAULT '{}',
  severity_levels notification_severity[] NOT NULL DEFAULT '{}',
  source_services VARCHAR(100)[] NOT NULL DEFAULT '{}',
  target_connector_ids UUID[] NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  throttle_window_seconds INTEGER,
  max_notifications_per_window INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_name_per_org
  ON notification_routes(organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_org_active
  ON notification_routes(organization_id, priority DESC)
  WHERE deleted_at IS NULL AND is_active;
