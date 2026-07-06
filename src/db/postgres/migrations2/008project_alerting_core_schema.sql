BEGIN;

-- ============================================================================
-- 3.1) Add project_id to existing notification tables
-- ============================================================================

-- Routes: NULL = org-wide route; NOT NULL = project-specific route
ALTER TABLE notification_routes
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Deliveries: every attempt knows which project it belongs to
ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- Dead letter: keep referential consistency for failed project alerts
ALTER TABLE notification_dead_letter
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- Audit logs: track which project was affected
ALTER TABLE connector_audit_logs
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- ============================================================================
-- 3.2) Indexes for the new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notification_routes_project
ON notification_routes(project_id)
WHERE deleted_at IS NULL AND is_active;

CREATE INDEX IF NOT EXISTS idx_notification_routes_org_project
ON notification_routes(organization_id, project_id)
WHERE deleted_at IS NULL AND is_active;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_project
ON notification_deliveries(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dead_letter_project
ON notification_dead_letter(project_id, created_at DESC);

-- ============================================================================
-- 3.3) NEW TABLE: project_member_alert_preferences
-- ----------------------------------------------------------------------------
-- This is the missing piece. It links project members to specific routes
-- and allows per-member opt-in/out per project.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_member_alert_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    -- FK to the org-wide route; application enforces route.project_id matches
    route_id UUID NOT NULL
        REFERENCES notification_routes(id) ON DELETE CASCADE,

    -- Can this member receive alerts for this project via this route?
    is_subscribed BOOLEAN NOT NULL DEFAULT true,

    -- Per-member overrides (e.g., only critical alerts)
    min_severity notification_severity NOT NULL DEFAULT 'info',

    -- Quiet hours (optional, application-enforced)
    quiet_hours_start TIME,
    quiet_hours_end TIME,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One preference record per member + project + route
    UNIQUE(project_id, user_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_member_prefs_user
ON project_member_alert_preferences(user_id, is_subscribed)
WHERE is_subscribed = true;

CREATE INDEX IF NOT EXISTS idx_member_prefs_project_route
ON project_member_alert_preferences(project_id, route_id, is_subscribed)
WHERE is_subscribed = true;

DROP TRIGGER IF EXISTS trg_project_member_alert_prefs_updated_at
ON project_member_alert_preferences;
CREATE TRIGGER trg_project_member_alert_prefs_updated_at
    BEFORE UPDATE ON project_member_alert_preferences
    FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ============================================================================
-- 3.4) NEW TABLE: project_alert_routes (optional junction)
-- ----------------------------------------------------------------------------
-- Use this ONLY if you want many-to-many: one project can have many routes,
-- and one route can serve many projects. If a route belongs to exactly one
-- project (or is org-wide), skip this and use notification_routes.project_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_alert_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,

    route_id UUID NOT NULL
        REFERENCES notification_routes(id) ON DELETE CASCADE,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(project_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_project_alert_routes_route
ON project_alert_routes(route_id)
WHERE is_active = true;

COMMIT;

BEGIN;

-- ============================================================================
-- 3.1) Add project_id to existing notification tables
-- ============================================================================

-- Routes: NULL = org-wide route; NOT NULL = project-specific route
ALTER TABLE notification_routes
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Deliveries: every attempt knows which project it belongs to
ALTER TABLE notification_deliveries
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- Dead letter: keep referential consistency for failed project alerts
ALTER TABLE notification_dead_letter
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- Audit logs: track which project was affected
ALTER TABLE connector_audit_logs
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- ============================================================================
-- 3.2) Indexes for the new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notification_routes_project
ON notification_routes(project_id)
WHERE deleted_at IS NULL AND is_active;

CREATE INDEX IF NOT EXISTS idx_notification_routes_org_project
ON notification_routes(organization_id, project_id)
WHERE deleted_at IS NULL AND is_active;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_project
ON notification_deliveries(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dead_letter_project
ON notification_dead_letter(project_id, created_at DESC);

-- ============================================================================
-- 3.3) NEW TABLE: project_member_alert_preferences
-- ----------------------------------------------------------------------------
-- This is the missing piece. It links project members to specific routes
-- and allows per-member opt-in/out per project.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_member_alert_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    -- FK to the org-wide route; application enforces route.project_id matches
    route_id UUID NOT NULL
        REFERENCES notification_routes(id) ON DELETE CASCADE,

    -- Can this member receive alerts for this project via this route?
    is_subscribed BOOLEAN NOT NULL DEFAULT true,

    -- Per-member overrides (e.g., only critical alerts)
    min_severity notification_severity NOT NULL DEFAULT 'info',

    -- Quiet hours (optional, application-enforced)
    quiet_hours_start TIME,
    quiet_hours_end TIME,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One preference record per member + project + route
    UNIQUE(project_id, user_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_member_prefs_user
ON project_member_alert_preferences(user_id, is_subscribed)
WHERE is_subscribed = true;

CREATE INDEX IF NOT EXISTS idx_member_prefs_project_route
ON project_member_alert_preferences(project_id, route_id, is_subscribed)
WHERE is_subscribed = true;

DROP TRIGGER IF EXISTS trg_project_member_alert_prefs_updated_at
ON project_member_alert_preferences;
CREATE TRIGGER trg_project_member_alert_prefs_updated_at
    BEFORE UPDATE ON project_member_alert_preferences
    FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ============================================================================
-- 3.4) NEW TABLE: project_alert_routes (optional junction)
-- ----------------------------------------------------------------------------
-- Use this ONLY if you want many-to-many: one project can have many routes,
-- and one route can serve many projects. If a route belongs to exactly one
-- project (or is org-wide), skip this and use notification_routes.project_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_alert_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,

    route_id UUID NOT NULL
        REFERENCES notification_routes(id) ON DELETE CASCADE,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(project_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_project_alert_routes_route
ON project_alert_routes(route_id)
WHERE is_active = true;

COMMIT;