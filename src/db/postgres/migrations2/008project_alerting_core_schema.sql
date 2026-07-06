-- Existing ENUMs
CREATE TYPE connector_type AS ENUM ('slack', 'discord', 'teams', 'pagerduty', 'webhook', 'email', 'sms');
CREATE TYPE connector_status AS ENUM ('active', 'inactive', 'error', 'pending_setup');
CREATE TYPE notification_severity AS ENUM ('info', 'warning', 'error', 'critical');
CREATE TYPE delivery_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');

-- Existing tables now have project_id columns
ALTER TABLE notification_routes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE notification_dead_letter ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE connector_audit_logs ADD COLUMN IF NOT EXISTS project_id UUID;

-- New project-scoped member preference table
CREATE TABLE project_member_alert_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
    is_subscribed BOOLEAN NOT NULL DEFAULT true,
    min_severity notification_severity NOT NULL DEFAULT 'info',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id, route_id)
);

CREATE INDEX idx_member_prefs_user ON project_member_alert_preferences(user_id, is_subscribed) WHERE is_subscribed = true;
CREATE INDEX idx_member_prefs_project_route ON project_member_alert_preferences(project_id, route_id, is_subscribed) WHERE is_subscribed = true;

-- Optional many-to-many junction (if route reusable across projects)
CREATE TABLE project_alert_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, route_id)
);

CREATE INDEX idx_project_alert_routes_route ON project_alert_routes(route_id) WHERE is_active = true;