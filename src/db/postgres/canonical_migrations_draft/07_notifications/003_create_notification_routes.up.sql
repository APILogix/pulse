BEGIN;

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

DROP TRIGGER IF EXISTS trg_notification_routes_updated_at ON notification_routes;
CREATE TRIGGER trg_notification_routes_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
