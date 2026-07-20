-- =============================================================================
-- Migration : 001_drop_all.sql
-- Generated : 2026-07-19T18:06:43.453Z
-- Purpose   : Drop ALL tables, types, and functions from the database
--             to allow a clean re-creation from canonical schema.
--
-- ⚠️  WARNING: This DESTROYS all data. Use only for dev/staging resets.
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════
-- DROP TABLES (reverse dependency order)
-- ═══════════════════════════════════════════════

DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS usage_daily_counters_default CASCADE;
DROP TABLE IF EXISTS feature_flags CASCADE;
DROP TABLE IF EXISTS error_groups CASCADE;
DROP TABLE IF EXISTS requests_default CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS errors_default CASCADE;
DROP TABLE IF EXISTS errors CASCADE;
DROP TABLE IF EXISTS ingestion_failures CASCADE;
DROP TABLE IF EXISTS sdk_sessions_default CASCADE;
DROP TABLE IF EXISTS sdk_sessions CASCADE;
DROP TABLE IF EXISTS messages_default CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS replays_default CASCADE;
DROP TABLE IF EXISTS replays CASCADE;
DROP TABLE IF EXISTS cron_checkins_default CASCADE;
DROP TABLE IF EXISTS cron_checkins CASCADE;
DROP TABLE IF EXISTS profiles_default CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS logs_default CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS metrics_default CASCADE;
DROP TABLE IF EXISTS metrics CASCADE;
DROP TABLE IF EXISTS traces_default CASCADE;
DROP TABLE IF EXISTS traces CASCADE;
DROP TABLE IF EXISTS spans_default CASCADE;
DROP TABLE IF EXISTS spans CASCADE;
DROP TABLE IF EXISTS analytics_alerts CASCADE;
DROP TABLE IF EXISTS analytics_saved_queries CASCADE;
DROP TABLE IF EXISTS analytics_dashboards CASCADE;
DROP TABLE IF EXISTS analytics_user_sessions CASCADE;
DROP TABLE IF EXISTS analytics_performance_summary CASCADE;
DROP TABLE IF EXISTS analytics_error_groups CASCADE;
DROP TABLE IF EXISTS project_usage_daily CASCADE;
DROP TABLE IF EXISTS project_usage_hourly_default CASCADE;
DROP TABLE IF EXISTS project_usage_hourly CASCADE;
DROP TABLE IF EXISTS analytics_daily_rollup CASCADE;
DROP TABLE IF EXISTS analytics_hourly_rollup CASCADE;
DROP TABLE IF EXISTS events_replays CASCADE;
DROP TABLE IF EXISTS events_cron_checkins CASCADE;
DROP TABLE IF EXISTS events_profiles CASCADE;
DROP TABLE IF EXISTS events_logs CASCADE;
DROP TABLE IF EXISTS events_traces CASCADE;
DROP TABLE IF EXISTS events_messages CASCADE;
DROP TABLE IF EXISTS events_metrics CASCADE;
DROP TABLE IF EXISTS events_spans CASCADE;
DROP TABLE IF EXISTS events_requests CASCADE;
DROP TABLE IF EXISTS events_errors CASCADE;
DROP TABLE IF EXISTS project_usage CASCADE;
DROP TABLE IF EXISTS ingestion_admin_logs_default CASCADE;
DROP TABLE IF EXISTS ingestion_admin_logs CASCADE;
DROP TABLE IF EXISTS ingestion_dead_letter_jobs CASCADE;
DROP TABLE IF EXISTS ingestion_jobs CASCADE;
DROP TABLE IF EXISTS backpressure_gauge CASCADE;
DROP TABLE IF EXISTS billing_audit_logs_2026_07 CASCADE;
DROP TABLE IF EXISTS billing_audit_logs CASCADE;
DROP TABLE IF EXISTS coupon_applicable_plans CASCADE;
DROP TABLE IF EXISTS coupon_redemptions CASCADE;
DROP TABLE IF EXISTS coupons CASCADE;
DROP TABLE IF EXISTS billing_webhook_events CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS ai_usage_logs_2026_07 CASCADE;
DROP TABLE IF EXISTS ai_usage_logs CASCADE;
DROP TABLE IF EXISTS usage_daily_counters_2026_07 CASCADE;
DROP TABLE IF EXISTS usage_daily_counters CASCADE;
DROP TABLE IF EXISTS organization_usage_current_period CASCADE;
DROP TABLE IF EXISTS organization_feature_overrides CASCADE;
DROP TABLE IF EXISTS subscription_addons CASCADE;
DROP TABLE IF EXISTS subscription_events CASCADE;
DROP TABLE IF EXISTS organization_subscriptions CASCADE;
DROP TABLE IF EXISTS plan_feature_entitlements CASCADE;
DROP TABLE IF EXISTS billing_features CASCADE;
DROP TABLE IF EXISTS plan_prices CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS alert_dead_letter_events CASCADE;
DROP TABLE IF EXISTS alert_throttle_windows CASCADE;
DROP TABLE IF EXISTS alert_metrics CASCADE;
DROP TABLE IF EXISTS alert_rule_executions CASCADE;
DROP TABLE IF EXISTS alert_routing_rules CASCADE;
DROP TABLE IF EXISTS alert_templates CASCADE;
DROP TABLE IF EXISTS alert_delivery_attempts CASCADE;
DROP TABLE IF EXISTS alert_event_batches CASCADE;
DROP TABLE IF EXISTS alert_escalation_steps CASCADE;
DROP TABLE IF EXISTS alert_escalation_policies CASCADE;
DROP TABLE IF EXISTS alert_acknowledgments CASCADE;
DROP TABLE IF EXISTS alert_silences CASCADE;
DROP TABLE IF EXISTS alert_event_history CASCADE;
DROP TABLE IF EXISTS alert_events CASCADE;
DROP TABLE IF EXISTS alert_rule_actions CASCADE;
DROP TABLE IF EXISTS alert_rule_conditions CASCADE;
DROP TABLE IF EXISTS alert_rules CASCADE;
DROP TABLE IF EXISTS notification_routes CASCADE;
DROP TABLE IF EXISTS notification_templates CASCADE;
DROP TABLE IF EXISTS if CASCADE;
DROP TABLE IF EXISTS connector_audit_logs_default CASCADE;
DROP TABLE IF EXISTS connector_audit_logs CASCADE;
DROP TABLE IF EXISTS connector_oauth_states CASCADE;
DROP TABLE IF EXISTS connector_test_runs CASCADE;
DROP TABLE IF EXISTS connector_health_checks_default CASCADE;
DROP TABLE IF EXISTS connector_health_checks CASCADE;
DROP TABLE IF EXISTS connector_delivery_attempts_default CASCADE;
DROP TABLE IF EXISTS connector_delivery_attempts CASCADE;
DROP TABLE IF EXISTS connector_deliveries_default CASCADE;
DROP TABLE IF EXISTS connector_deliveries CASCADE;
DROP TABLE IF EXISTS connector_routes CASCADE;
DROP TABLE IF EXISTS connector_secret_versions CASCADE;
DROP TABLE IF EXISTS connector_credentials CASCADE;
DROP TABLE IF EXISTS connector_configs CASCADE;
DROP TABLE IF EXISTS project_api_keys CASCADE;
DROP TABLE IF EXISTS project_settings CASCADE;
DROP TABLE IF EXISTS project_releases CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS saml_sessions CASCADE;
DROP TABLE IF EXISTS scim_group_memberships CASCADE;
DROP TABLE IF EXISTS scim_groups CASCADE;
DROP TABLE IF EXISTS organization_scim_token_ips CASCADE;
DROP TABLE IF EXISTS organization_scim_token_scopes CASCADE;
DROP TABLE IF EXISTS scim_user_mappings CASCADE;
DROP TABLE IF EXISTS organization_scim_tokens CASCADE;
DROP TABLE IF EXISTS organization_sso_providers CASCADE;
DROP TABLE IF EXISTS organization_verified_domains CASCADE;
DROP TABLE IF EXISTS organization_alert_thresholds CASCADE;
DROP TABLE IF EXISTS organization_email_outbox CASCADE;
DROP TABLE IF EXISTS organization_security_events CASCADE;
DROP TABLE IF EXISTS organization_audit_logs CASCADE;
DROP TABLE IF EXISTS quota_requests CASCADE;
DROP TABLE IF EXISTS organization_invitations CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organization_settings CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS auth_email_outbox CASCADE;
DROP TABLE IF EXISTS user_linked_identities CASCADE;
DROP TABLE IF EXISTS user_trusted_devices CASCADE;
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS email_mfa_otps CASCADE;
DROP TABLE IF EXISTS email_verifications CASCADE;
DROP TABLE IF EXISTS user_backup_codes CASCADE;
DROP TABLE IF EXISTS user_mfa_devices CASCADE;
DROP TABLE IF EXISTS statement CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS billing_plans CASCADE;
DROP TABLE IF EXISTS connector_secrets CASCADE;
DROP TABLE IF EXISTS error_events CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS notification_dead_letter CASCADE;
DROP TABLE IF EXISTS notification_deliveries CASCADE;
DROP TABLE IF EXISTS organization_api_keys CASCADE;
DROP TABLE IF EXISTS organization_billing CASCADE;
DROP TABLE IF EXISTS organization_environments CASCADE;
DROP TABLE IF EXISTS organization_invoices CASCADE;
DROP TABLE IF EXISTS organization_payment_methods CASCADE;
DROP TABLE IF EXISTS organization_usage CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;
DROP TABLE IF EXISTS request_events CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS usage_counter_staging CASCADE;

-- ═══════════════════════════════════════════════
-- DROP ENUM TYPES
-- ═══════════════════════════════════════════════

DROP TYPE IF EXISTS billing_plan_tier CASCADE;
DROP TYPE IF EXISTS billing_subscription_status CASCADE;
DROP TYPE IF EXISTS billing_provider_type CASCADE;
DROP TYPE IF EXISTS billing_interval_type CASCADE;
DROP TYPE IF EXISTS billing_invoice_status CASCADE;
DROP TYPE IF EXISTS billing_payment_status CASCADE;
DROP TYPE IF EXISTS billing_coupon_discount_type CASCADE;
DROP TYPE IF EXISTS billing_feature_value_type CASCADE;
DROP TYPE IF EXISTS billing_feature_category CASCADE;
DROP TYPE IF EXISTS subscription_event_type CASCADE;
DROP TYPE IF EXISTS subscription_event_actor CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS mfa_type CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS security_event_type CASCADE;
DROP TYPE IF EXISTS org_status CASCADE;
DROP TYPE IF EXISTS member_status CASCADE;
DROP TYPE IF EXISTS org_role CASCADE;
DROP TYPE IF EXISTS joined_method CASCADE;
DROP TYPE IF EXISTS invitation_status CASCADE;
DROP TYPE IF EXISTS quota_request_status CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;
DROP TYPE IF EXISTS project_environment CASCADE;
DROP TYPE IF EXISTS project_member_role CASCADE;
DROP TYPE IF EXISTS api_key_status CASCADE;
DROP TYPE IF EXISTS notification_severity CASCADE;
DROP TYPE IF EXISTS delivery_status CASCADE;
DROP TYPE IF EXISTS alert_severity CASCADE;
DROP TYPE IF EXISTS alert_status CASCADE;
DROP TYPE IF EXISTS alert_condition_type CASCADE;
DROP TYPE IF EXISTS alert_condition_operator CASCADE;
DROP TYPE IF EXISTS alert_action_type CASCADE;
DROP TYPE IF EXISTS alert_event_status CASCADE;
DROP TYPE IF EXISTS delivery_attempt_status CASCADE;
DROP TYPE IF EXISTS batch_status CASCADE;
DROP TYPE IF EXISTS history_action CASCADE;
DROP TYPE IF EXISTS metric_granularity CASCADE;
DROP TYPE IF EXISTS alert_dead_letter_status CASCADE;
DROP TYPE IF EXISTS ingestion_job_state CASCADE;
DROP TYPE IF EXISTS ingestion_job_priority CASCADE;
DROP TYPE IF EXISTS event_severity CASCADE;
DROP TYPE IF EXISTS span_status CASCADE;
DROP TYPE IF EXISTS span_kind CASCADE;
DROP TYPE IF EXISTS analytics_metric_type CASCADE;
DROP TYPE IF EXISTS log_level CASCADE;
DROP TYPE IF EXISTS cron_status CASCADE;
DROP TYPE IF EXISTS error_group_status CASCADE;
DROP TYPE IF EXISTS rollup_granularity CASCADE;
DROP TYPE IF EXISTS analytics_alert_operator CASCADE;

-- ═══════════════════════════════════════════════
-- DROP FUNCTIONS
-- ═══════════════════════════════════════════════

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS flush_usage_counters() CASCADE;

COMMIT;
