-- =============================================================================
-- Migration   : 004_enterprise_database_integrity.sql
-- Description : Enterprise Database Integrity & Performance Optimization
-- Author      : Antigravity AI Engine
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

-- 1. Partial unique constraint for active connector configurations per org & name
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_configs_org_name_active
    ON connector_configs(organization_id, name)
    WHERE deleted_at IS NULL;

-- 2. Performance index for active organization membership lookups
CREATE INDEX IF NOT EXISTS idx_org_members_user_status
    ON organization_members(user_id, status)
    WHERE deleted_at IS NULL;

-- 3. Composite index for active alert rules per org and project
CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project_active
    ON alert_rules(organization_id, project_id)
    WHERE deleted_at IS NULL;

-- 4. Index for organization current usage lookup performance
CREATE INDEX IF NOT EXISTS idx_org_usage_current_period
    ON organization_usage_current_period(organization_id, period_start, period_end);

COMMIT;
