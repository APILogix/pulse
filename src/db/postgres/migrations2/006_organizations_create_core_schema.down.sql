-- ============================================================================
-- 006_organizations_create_core_schema.down.sql
-- ----------------------------------------------------------------------------
-- Reverses 006. We ONLY drop the capabilities this migration introduced
-- (organization_email_outbox, organization_alert_thresholds, and the
-- organization_audit_logs table the migration added). The core organization
-- tables (organizations, organization_members, settings, invitations, etc.)
-- and their enums are shared, pre-date this migration in the legacy
-- orgtables.sql, and are NOT dropped here â€” doing so would cascade-delete every
-- tenant's data and break the alerting/analytics/connectors modules that
-- reference organizations(id).
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS scim_user_mappings CASCADE;
DROP TABLE IF EXISTS organization_alert_thresholds CASCADE;
DROP TABLE IF EXISTS organization_email_outbox CASCADE;
DROP TABLE IF EXISTS organization_audit_logs CASCADE;

COMMIT;

