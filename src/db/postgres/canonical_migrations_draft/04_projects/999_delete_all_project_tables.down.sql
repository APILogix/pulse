-- DESTRUCTIVE MANUAL TEARDOWN ONLY.
-- Deletes every project-owned table and all contained data.
-- Excluded from automatic migration discovery by the .down.sql suffix.
BEGIN;

DROP VIEW IF EXISTS project_usage_realtime CASCADE;
DROP VIEW IF EXISTS api_key_usage_monthly CASCADE;
DROP VIEW IF EXISTS api_key_usage_hourly CASCADE;
DROP FUNCTION IF EXISTS rollup_project_usage() CASCADE;
DROP FUNCTION IF EXISTS flush_usage_counters() CASCADE;
DROP FUNCTION IF EXISTS enforce_api_key_usage_tenant_dimensions() CASCADE;
DROP FUNCTION IF EXISTS provision_environment_sdk_config() CASCADE;
DROP FUNCTION IF EXISTS reject_sdk_config_revision_update() CASCADE;
DROP FUNCTION IF EXISTS provision_project_schema_defaults() CASCADE;
DROP FUNCTION IF EXISTS enforce_project_tenant_integrity() CASCADE;

DROP TABLE IF EXISTS project_environment_sdk_config_revisions CASCADE;
DROP TABLE IF EXISTS project_environment_sdk_configs CASCADE;
DROP TABLE IF EXISTS project_member_alert_channel_preferences CASCADE;
DROP TABLE IF EXISTS project_notification_preferences CASCADE;
DROP TABLE IF EXISTS project_connector_subscriptions CASCADE;
DROP TABLE IF EXISTS project_alert_channels CASCADE;
DROP TABLE IF EXISTS project_alert_thresholds CASCADE;
DROP TABLE IF EXISTS api_key_usage_daily CASCADE;
DROP TABLE IF EXISTS api_key_usage_minute CASCADE;
DROP TABLE IF EXISTS telemetry_event_types CASCADE;
DROP TABLE IF EXISTS project_api_key_rotations CASCADE;
DROP TABLE IF EXISTS project_usage_current CASCADE;
DROP TABLE IF EXISTS project_usage_monthly CASCADE;
DROP TABLE IF EXISTS project_usage_daily CASCADE;
DROP TABLE IF EXISTS project_usage_hourly CASCADE;
DROP TABLE IF EXISTS project_usage_minute CASCADE;
DROP TABLE IF EXISTS project_releases CASCADE;
DROP TABLE IF EXISTS project_api_keys CASCADE;
DROP TABLE IF EXISTS project_environments CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS project_settings CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

DROP TYPE IF EXISTS project_environment_type CASCADE;
DROP TYPE IF EXISTS api_key_rotation_state CASCADE;
DROP TYPE IF EXISTS api_key_type CASCADE;
DROP TYPE IF EXISTS api_key_status CASCADE;
DROP TYPE IF EXISTS project_invitation_status CASCADE;
DROP TYPE IF EXISTS project_member_status CASCADE;
DROP TYPE IF EXISTS project_member_role CASCADE;
DROP TYPE IF EXISTS project_visibility CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;

COMMIT;
