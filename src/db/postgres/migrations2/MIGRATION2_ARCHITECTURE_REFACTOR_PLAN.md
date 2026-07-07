# Migration2 Architecture Refactor Plan

## 1. Executive Summary

Overall migration quality: functional but structurally inconsistent. The numbered chain does bootstrap a broad platform schema, but it mixes bounded contexts, carries helper SQL outside the formal chain, and contains several late additive fixes that should be part of domain-local histories.

Major issues:
- Mixed migrations inside core files, especially `001`, `003`, `006`, `008`, `015`, `019`, `022`, and `031`.
- Non-chain SQL files: `008project_alerting_core_schema.sql`, `bugfix.sql`, `index.sql`.
- Missing sequence numbers: `024`, `025`, `026`.
- Duplicate helper functions by name and intent: `update_updated_at_column`, `set_updated_at`, `connector_set_updated_at`.
- Duplicate extension creation (`pgcrypto`) across many files.
- Incomplete rollback coverage and poor rollback granularity in late project migrations.
- UTF-16 encoded single-line migrations in `027`-`029`, which hurts readability and tooling safety.
- Potential invalid dependency order: `005_auth_extend_mfa_schema` alters `organization_settings` before `006_organizations_create_core_schema` creates it.
- Dead or superseded object path: `project_alert_routes` is created in `008project_alerting_core_schema.sql` and dropped in `022`.

Risk level: high for refactor-by-move only, medium for refactor with a new clean bootstrap chain.

Architecture score: 4/10  
Maintainability score: 4/10  
Scalability score: 5/10  
Organization score: 3/10  
Enterprise readiness score: 5/10

## 2. Complete Migration Inventory

Execution model observed:
- The intended bootstrap chain is the lexicographic `*.up.sql` files.
- `README.md` explicitly says the runner should apply `*.up.sql` only.
- `008project_alerting_core_schema.sql`, `bugfix.sql`, and `index.sql` are outside that contract and are operational outliers.

Sequence gaps:
- `024`, `025`, `026` do not exist.

### 001_auth_create_core_schema

Files:
- `001_auth_create_core_schema.up.sql`
- `001_auth_create_core_schema.down.sql`

Execution order: 1

Creates:
- Extension: `pgcrypto`
- Enums: `user_status`, `mfa_type`, `session_status`, `security_event_type`
- Functions: `update_updated_at_column`, `tombstone_deleted_email`
- Tables: `users`, `user_sessions`, `user_mfa_devices`, `email_verifications`, `email_mfa_otps`, `security_events`, `audit_logs`, `user_trusted_devices`, `user_linked_identities`, `auth_email_outbox`
- Triggers: `update_users_updated_at`, `update_mfa_devices_updated_at`, `users_tombstone_on_delete`

Indexes:
- `users`: `idx_users_email_hash`, `idx_users_status`, `idx_users_locked`, `idx_users_is_admin`, `idx_users_created_cursor`, `idx_users_deletion_scheduled`
- `user_sessions`: `idx_sessions_refresh_token`, `idx_sessions_previous_refresh_token_unique`, `idx_sessions_user_active`, `idx_sessions_cleanup`, `idx_sessions_purge`, `idx_sessions_saml_name_id`
- `user_mfa_devices`: `one_primary_mfa`, `idx_mfa_devices_user`, `idx_mfa_devices_credential_id`
- `email_verifications`: `idx_email_verifications_active_token_hash`, `idx_email_verifications_user_purpose_active`, `idx_email_verifications_cleanup`
- `email_mfa_otps`: `idx_email_mfa_otps_active_device`, `idx_email_mfa_otps_user`, `idx_email_mfa_otps_cleanup`
- `security_events`: `idx_security_user_time`, `idx_security_open`, `idx_security_ip_time`
- `audit_logs`: `idx_audit_user_time`, `idx_audit_org_time`, `idx_audit_action_time`, `idx_audit_resource`, `idx_audit_request`, `idx_audit_metadata_gin`
- `user_trusted_devices`: `idx_trusted_devices_user_active`
- `user_linked_identities`: no provider+subject unique index in this file
- `auth_email_outbox`: `idx_auth_email_outbox_pending`, `idx_auth_email_outbox_processing_started`, `idx_auth_email_outbox_sent_cleanup`, `idx_auth_email_outbox_failed_cleanup`

Constraints and foreign keys:
- Internal auth FKs to `users` and `user_mfa_devices`
- Cross-domain reference to `organizations` from `audit_logs`

Ownership:
- Auth owns `users`, sessions, MFA, verification, linked identities, trusted devices, auth outbox
- Audit owns `audit_logs`
- Security owns `security_events`

Dependencies:
- Runtime dependency on `organizations` despite this being migration 1
- Extension dependency on `pgcrypto`

Down behavior:
- Drops auth core objects, but rollback is coarse-grained.

### 002_connectors_create_notification_schema

Files:
- `002_connectors_create_notification_schema.up.sql`
- `002_connectors_create_notification_schema.down.sql`

Execution order: 2

Creates:
- Extension: `pgcrypto`
- Enums: `connector_type`, `connector_status`, `notification_severity`, `delivery_status`
- Function: `connector_set_updated_at`
- Tables: `connector_configs`, `connector_secrets`, `notification_templates`, `notification_routes`, `notification_deliveries`, `notification_dead_letter`, `connector_health_checks`, `connector_audit_logs`
- Triggers on connector and notification tables

Indexes:
- `connector_configs`: `uq_connector_name_per_org`, `idx_connector_configs_org`, `idx_connector_configs_type`, `idx_connector_configs_status`
- `connector_secrets`: `idx_connector_secrets_connector`
- `notification_templates`: `uq_template_name_per_org`, `idx_templates_org_type`
- `notification_routes`: `uq_route_name_per_org`, `idx_routes_org_active`
- `notification_deliveries`: `idx_deliveries_org_created`, `idx_deliveries_connector`, `idx_deliveries_status`, `idx_deliveries_correlation`, `idx_deliveries_next_retry`, `idx_deliveries_scheduled`
- `notification_dead_letter`: `idx_dead_letter_org`, `idx_dead_letter_connector`, `idx_dead_letter_unresolved`
- `connector_health_checks`: `idx_health_checks_connector`
- `connector_audit_logs`: `idx_connector_audit_logs_org`, `idx_connector_audit_logs_connector`

Constraints and foreign keys:
- FKs to `users`, `organizations`, `connector_configs`, `notification_routes`, `notification_deliveries`

Ownership:
- Mixed: connectors domain plus notifications domain

Dependencies:
- `users`, `organizations`

Down behavior:
- Drops full connector and notification stack together.

### 003_alerting_create_core_schema

Files:
- `003_alerting_create_core_schema.up.sql`
- `003_alerting_create_core_schema.down.sql`

Execution order: 3

Creates:
- Extension: `pgcrypto`
- Enums: `alert_severity`, `alert_status`, `alert_condition_type`, `alert_condition_operator`, `alert_action_type`, `alert_event_status`, `delivery_attempt_status`, `batch_status`, `history_action`, `metric_granularity`
- Reuses function name `connector_set_updated_at`
- Tables: `alert_rules`, `alert_rule_conditions`, `alert_rule_actions`, `alert_events`, `alert_event_history`, `alert_silences`, `alert_acknowledgments`, `alert_escalation_policies`, `alert_escalation_steps`, `alert_event_batches`, `alert_delivery_attempts`, `alert_templates`, `alert_routing_rules`, `alert_rule_executions`, `alert_metrics`
- Triggers across most mutable alert tables

Indexes:
- Rule/config indexes: `uq_alert_rule_name_per_org`, `idx_alert_rules_org`, `idx_alert_rules_enabled`, `idx_alert_rules_severity`, `idx_alert_rule_conditions_rule`, `idx_alert_rule_conditions_group`, `idx_alert_rule_actions_rule`, `idx_alert_rule_actions_connector`
- Event indexes: `idx_alert_events_org_status`, `idx_alert_events_org_rule`, `idx_alert_events_fingerprint`, `idx_alert_events_source`, `idx_alert_events_group`, `idx_alert_events_next_escalation`, `idx_alert_events_auto_resolve`, `idx_alert_event_history_event`, `idx_alert_event_history_org`
- Silence/ack indexes: `idx_alert_silences_active`, `idx_alert_silences_rule`, `uq_active_ack_per_event`, `idx_alert_acks_org`
- Escalation indexes: `uq_escalation_policy_name_per_org`, `idx_alert_escalation_steps_policy`
- Delivery/routing indexes: `idx_alert_event_batches_status`, `idx_alert_event_batches_org`, `idx_alert_delivery_attempts_event`, `idx_alert_delivery_attempts_connector`, `idx_alert_delivery_attempts_status`, `idx_alert_delivery_attempts_batch`, `uq_alert_template_name_per_org`, `idx_alert_templates_org`, `uq_alert_routing_rule_name_per_org`, `idx_alert_routing_rules_active`
- Execution/metric indexes: `idx_alert_rule_executions_rule`, `idx_alert_rule_executions_org`, `uq_alert_metric_bucket`, `idx_alert_metrics_lookup`

Constraints and foreign keys:
- FKs to `users`, `organizations`, `connector_configs`, `notification_routes`, `alert_rules`, `alert_events`, `alert_escalation_policies`, `alert_event_batches`, `alert_templates`

Ownership:
- Primarily alerting, but tightly coupled to connectors/notifications

Dependencies:
- `organizations`, `users`, connector and notification objects from `002`

Down behavior:
- Coarse domain rollback.

### 004_analytics_create_core_schema

Files:
- `004_analytics_create_core_schema.up.sql`
- `004_analytics_create_core_schema.down.sql`

Execution order: 4

Creates:
- Extensions: `pgcrypto`, `timescaledb`
- Enums: `event_severity`, `span_status`, `span_kind`, `analytics_metric_type`, `log_level`, `cron_status`, `error_group_status`, `rollup_granularity`, `analytics_alert_operator`
- Functions: `update_updated_at_column`, `create_event_partitions`, `refresh_hourly_rollup`
- Raw event tables: `events_errors`, `events_messages`, `events_requests`, `events_spans`, `events_traces`, `events_metrics`, `events_logs`, `events_profiles`, `events_cron_checkins`, `events_replays`
- Analytics tables: `analytics_hourly_rollup`, `analytics_daily_rollup`, `analytics_error_groups`, `analytics_performance_summary`, `analytics_user_sessions`, `analytics_dashboards`, `analytics_saved_queries`, `analytics_alerts`
- Triggers on rollup and dashboard-style tables

Indexes:
- Extensive BRIN, GIN, and lookup indexes across all `events_*` and `analytics_*` tables, including `idx_errors_*`, `idx_messages_*`, `idx_requests_*`, `idx_spans_*`, `idx_traces_*`, `idx_metrics_*`, `idx_logs_*`, `idx_profiles_*`, `idx_crons_*`, `idx_replays_*`, `idx_hourly_rollup_org_hour`, `idx_daily_rollup_org_date`, `idx_error_groups_org_*`, `idx_perf_summary_org_route`, `idx_user_sessions_org`, `idx_dashboards_org`, `idx_saved_queries_org`, `idx_analytics_alerts_org`

Constraints and foreign keys:
- Mostly org/project scoped analytical references

Ownership:
- Mixed: raw observability ingestion storage plus analytics products

Dependencies:
- `timescaledb`
- Shared updated-at function duplicated from auth by name

Down behavior:
- Large coarse rollback with extension and table drop coupling.

### 005_auth_extend_mfa_schema

Files:
- `005_auth_extend_mfa_schema.up.sql`
- `005_auth_extend_mfa_schema.down.sql`

Execution order: 5

Creates:
- Extension: `pgcrypto`
- Table: `sms_mfa_otps`
- Alters: `user_mfa_devices`, `organization_settings`

Indexes:
- `idx_sms_mfa_otps_active_device`, `idx_sms_mfa_otps_user`, `idx_sms_mfa_otps_cleanup`

Constraints and foreign keys:
- FKs to `users`, `user_mfa_devices`
- Organization policy columns added to `organization_settings`

Ownership:
- Mixed: auth MFA plus organization policy

Dependencies:
- `user_mfa_devices` from `001`
- `organization_settings` from `006`, but the file is ordered before `006`

Down behavior:
- Attempts to reverse table and org-setting changes together.

### 006_organizations_create_core_schema

Files:
- `006_organizations_create_core_schema.up.sql`
- `006_organizations_create_core_schema.down.sql`

Execution order: 6

Creates:
- Extension: `pgcrypto`
- Enums: `org_status`, `member_status`, `org_role`, `invitation_status`, `joined_method`, `quota_request_status`, `security_event_severity`
- Function: `set_updated_at`
- Tables: `organizations`, `organization_settings`, `organization_members`, `organization_invitations`, `quota_requests`, `organization_audit_logs`, `organization_environments`, `organization_api_keys`, `organization_sso_providers`, `organization_scim_tokens`, `scim_user_mappings`, `organization_security_events`, `organization_email_outbox`, `organization_alert_thresholds`
- Triggers on organizations, settings, members, quota requests, thresholds

Indexes:
- Org indexes: `idx_org_slug_active`, `idx_orgs_owner`, `idx_orgs_status`
- Membership/invite indexes: `idx_org_members_org`, `idx_org_members_user`, `idx_org_members_role`, `idx_unique_active_invite`, `idx_org_invitations_token`, `idx_org_invitations_org`
- Quota/audit indexes: `idx_quota_requests_org`, `idx_org_audit_org_created`, `idx_org_audit_actor`, `idx_org_audit_entity`, `idx_org_audit_action`, `idx_org_audit_sensitive`, `idx_org_audit_metadata_gin`
- API/SSO/SCIM/security/outbox/threshold indexes: `idx_api_keys_org`, `idx_sso_providers_org`, `idx_sso_providers_active_domain_type`, `idx_sso_providers_active_entity_id`, `idx_scim_tokens_org`, `idx_scim_tokens_org_token_active`, `idx_scim_user_mappings_user`, `idx_org_security_events_org`, `idx_org_email_outbox_due`, `idx_org_email_outbox_org`, `uq_org_email_outbox_dedupe`, `uq_org_alert_thresholds_scope`, `idx_org_alert_thresholds_org`

Constraints and foreign keys:
- FKs to `users`, `organizations`, `organization_environments`

Ownership:
- Mixed: organizations, membership, invite flow, quotas, org audit, org API keys, SSO, SCIM tokens, security events, org email outbox, alert thresholds

Dependencies:
- `users` from auth

Down behavior:
- Drops the entire organization platform in one step.

### 007_organizations_create_sdk_config_schema

Files:
- `007_organizations_create_sdk_config_schema.up.sql`
- `007_organizations_create_sdk_config_schema.down.sql`

Execution order: 7

Creates:
- Extension: `pgcrypto`
- Tables: `sdk_configs`, `sdk_config_versions`, `sdk_config_deployments`, `sdk_config_field_policies`, `sdk_config_templates`
- Reuses function `set_updated_at`
- Triggers on sdk config tables

Indexes:
- `sdk_configs`: `uq_sdk_configs_live_scope`, `idx_sdk_configs_org_active`, `idx_sdk_configs_project_active`, `idx_sdk_configs_value_gin`
- `sdk_config_versions`: `idx_sdk_config_versions_config`, `idx_sdk_config_versions_created_at`
- `sdk_config_deployments`: `idx_sdk_config_deployments_config`, `idx_sdk_config_deployments_status`
- `sdk_config_field_policies`: `idx_sdk_config_field_policies_plan`
- `sdk_config_templates`: `idx_sdk_config_templates_plan_env`, `idx_sdk_config_templates_value_gin`

Constraints and foreign keys:
- FKs to `organizations`, `users`, `sdk_configs`

Ownership:
- Remote config / SDK config domain

Dependencies:
- `organizations`, optionally projects

Down behavior:
- Reasonable bounded rollback.

### 008_projects_create_core_schema

Files:
- `008_projects_create_core_schema.up.sql`
- `008_projects_create_core_schema.down.sql`

Execution order: 8

Creates:
- Enums: `project_status`, `project_environment`, `api_key_status`
- Tables: `projects`, `project_api_keys`, `project_members`, `project_releases`

Indexes:
- `projects`: `idx_projects_org`, `idx_projects_status`, `idx_projects_cursor`, `idx_projects_archived`, `idx_projects_org_status`
- `project_api_keys`: `idx_api_keys_project`, `idx_api_keys_prefix`, `idx_api_keys_status`, `idx_api_keys_expiry`, `idx_api_keys_last_used`, `idx_api_keys_project_env`, `idx_api_keys_revoked_cleanup`
- `project_members`: `idx_project_members_project`, `idx_project_members_user`, `idx_project_members_role`, `idx_project_members_user_project`
- `project_releases`: `idx_project_releases_project`, `idx_project_releases_environment`, `idx_project_releases_version`, `idx_project_releases_time`, `idx_project_releases_project_env_time`, `idx_project_releases_commit`

Constraints and foreign keys:
- FKs to `organizations`, `users`, `projects`
- Reference to `organization_roles` is present in the SQL and should be validated against actual object creation, because `organization_roles` is not created in `006`

Ownership:
- Mixed: projects, project memberships, project API keys, release management

Dependencies:
- `organizations`, `users`

Down behavior:
- Drops project core together.

### 008project_alerting_core_schema

Files:
- `008project_alerting_core_schema.sql`

Execution order:
- Outside numbered `*.up.sql` / `*.down.sql` chain
- Operationally ambiguous

Creates:
- Recreates enums already defined in `002`: `connector_type`, `connector_status`, `notification_severity`, `delivery_status`
- Alters connector/notification tables by adding `project_id`
- Tables: `project_member_alert_preferences`, `project_alert_routes`
- Indexes: `idx_member_prefs_user`, `idx_member_prefs_project_route`, `idx_project_alert_routes_route`

Ownership:
- Mixed: project membership alert preferences plus notification route scoping

Dependencies:
- `projects`, `users`, `notification_routes`

Risk:
- Duplicate enum definitions if run after `002`
- Not part of the chain described in `README.md`
- Superseded in part by `022`

### 009_ingestion_create_queue_schema

Files:
- `009_ingestion_create_queue_schema.up.sql`
- `009_ingestion_create_queue_schema.down.sql`

Execution order: 9

Creates:
- Extension: `pgcrypto`
- Enums: `ingestion_job_state`, `ingestion_job_priority`
- Function: `set_updated_at`
- Tables: `ingestion_jobs`, `ingestion_dead_letter_jobs`, `ingestion_admin_logs`, `ingestion_admin_logs_default`
- Trigger: `trg_ingestion_jobs_updated_at`

Indexes:
- Jobs: `idx_ingestion_jobs_claim`, `idx_ingestion_jobs_claim_typed`, `idx_ingestion_jobs_lease`, `idx_ingestion_jobs_dedupe`, `idx_ingestion_jobs_project`, `idx_ingestion_jobs_org_state`, `idx_ingestion_jobs_event_id`, `idx_ingestion_jobs_trace_id`, `idx_ingestion_jobs_completed`
- DLQ: `idx_dlq_queue_time`, `idx_dlq_project`, `idx_dlq_unreplayed`, `idx_dlq_original_job`
- Admin logs: `idx_admin_logs_created`, `idx_admin_logs_category`, `idx_admin_logs_project`, `idx_admin_logs_level`, `idx_admin_logs_metadata`

Ownership:
- Ingestion queue / admin operations

Dependencies:
- Shared `set_updated_at`

Down behavior:
- Domain-bounded rollback.

### 010_ingestion_create_usage_counters_schema

Files:
- `010_ingestion_create_usage_counters_schema.up.sql`
- `010_ingestion_create_usage_counters_schema.down.sql`

Execution order: 10

Creates:
- Table: `project_usage`
- Implicitly also manages staging/rollup infrastructure; index names reference `usage_counter_staging`
- Functions: `set_updated_at`, `flush_usage_counters`
- Trigger: `trg_project_usage_updated_at`

Indexes:
- `usage_counter_staging`: `idx_usage_staging_project`, `idx_usage_staging_flush`
- `project_usage`: `idx_project_usage_lookup`, `idx_project_usage_org`

Ownership:
- Mixed: ingestion usage staging plus reporting table

Dependencies:
- Projects and organizations, even when not directly parsed from the first pass

Down behavior:
- Limited rollback.

### 011_ingestion_create_legacy_compat_schema

Files:
- `011_ingestion_create_legacy_compat_schema.up.sql`
- `011_ingestion_create_legacy_compat_schema.down.sql`

Execution order: 11

Creates:
- Extension: `pgcrypto`
- Legacy compatibility tables: `spans`, `traces`, `metrics`, `logs`, `profiles`, `cron_checkins`, `replays`, `messages`, `sdk_sessions`, `ingestion_failures`, `errors`, `requests`, `error_groups`
- Default partitions/tables for each legacy stream: `*_default`

Indexes:
- Many legacy-path lookup indexes: `idx_spans_*`, `idx_traces_*`, `idx_metrics_*`, `idx_logs_*`, `idx_profiles_*`, `idx_cron_monitor_time`, `idx_replays_session`, `idx_messages_project_time`, `idx_sdk_sessions_unique`, `idx_ingestion_failures_*`, `idx_errors_*`, `idx_requests_*`, `idx_error_groups_active`

Ownership:
- Legacy compatibility / deprecated ingestion facade

Dependencies:
- Compatibility with code still referencing old names

Risk:
- This entire file is a migration smell by design; it exists for compatibility, not clean ownership.

### 012_auth_harden_email_outbox_schema

Files:
- `012_auth_harden_email_outbox_schema.up.sql`
- `012_auth_harden_email_outbox_schema.down.sql`

Execution order: 12

Creates/alters:
- Alters `auth_email_outbox`
- Recreates processing/cleanup indexes: `idx_auth_email_outbox_processing_started`, `idx_auth_email_outbox_sent_cleanup`, `idx_auth_email_outbox_failed_cleanup`

Ownership:
- Auth outbox

Dependencies:
- `auth_email_outbox` from `001`

### 013_platform_backfill_connectors_alerting_foreign_keys

Files:
- `013_platform_backfill_connectors_alerting_foreign_keys.up.sql`
- `013_platform_backfill_connectors_alerting_foreign_keys.down.sql`

Execution order: 13

Creates/alters:
- Backfills and adds org foreign keys across connector and alerting tables
- Affects `connector_configs`, `notification_templates`, `notification_routes`, `notification_deliveries`, `notification_dead_letter`, `connector_audit_logs`, `alert_rules`, `alert_events`, `alert_event_history`, `alert_silences`, `alert_acknowledgments`, `alert_escalation_policies`, `alert_event_batches`, `alert_delivery_attempts`, `alert_templates`, `alert_routing_rules`, `alert_rule_executions`, `alert_metrics`, `alert_rule_actions`, `alert_escalation_steps`

Ownership:
- Mixed platform-wide integrity fix spanning connectors and alerting

Dependencies:
- `organizations`
- Existing notification and alert tables

### 014_organizations_backfill_mfa_policy_columns

Files:
- `014_organizations_backfill_mfa_policy_columns.up.sql`
- `014_organizations_backfill_mfa_policy_columns.down.sql`

Execution order: 14

Creates/alters:
- Backfills/normalizes MFA policy columns on `organization_settings`

Ownership:
- Organizations security policy

Dependencies:
- `organization_settings`

### 015_billing_create_core_schema

Files:
- `015_billing_create_core_schema.up.sql`
- `015_billing_create_core_schema.down.sql`

Execution order: 15

Creates:
- Extension: `pgcrypto`
- Enums: `billing_plan_tier`, `billing_subscription_status`, `billing_provider_type`, `billing_interval_type`, `billing_invoice_status`, `billing_coupon_discount_type`
- Function: `set_updated_at`
- Tables: `plans`, `organization_subscriptions`, `subscription_events`, `usage_daily_counters`, `invoices`, `coupons`, `coupon_redemptions`
- Triggers: `trg_plans_updated_at`, `trg_org_subscriptions_updated_at`, `trg_usage_daily_counters_updated_at`, `trg_coupons_updated_at`

Indexes:
- `plans`: `idx_plans_active_public`, `idx_plans_feature_config`, `idx_plans_tier_active`
- `organization_subscriptions`: `idx_org_sub_one_active`, `idx_org_sub_provider_lookup`, `idx_org_sub_period_end`, `idx_org_sub_trial_end`, `idx_org_sub_org_created`
- `subscription_events`: `idx_sub_events_org_time`, `idx_sub_events_sub_time`
- `usage_daily_counters`: `idx_usage_org_date_brin`, `idx_usage_org_lookup`, `idx_usage_project_lookup`
- `invoices`: `idx_invoices_org`, `idx_invoices_subscription`, `idx_invoices_status`
- `coupons`: `idx_coupons_active`, `idx_coupons_valid_until`
- `coupon_redemptions`: `idx_coupon_redemptions_org`

Constraints and foreign keys:
- FKs to `organizations`, `plans`, `organization_subscriptions`, `projects`, `coupons`

Ownership:
- Mixed: billing catalog, subscriptions, usage accounting, invoicing, discounts

Dependencies:
- `organizations`, `projects`

### 016_billing_allow_org_level_usage

Files:
- `016_billing_allow_org_level_usage.up.sql`
- `016_billing_allow_org_level_usage.down.sql`

Execution order: 16

Creates/alters:
- Alters `usage_daily_counters.project_id` nullability
- Replaces uniqueness strategy with `uq_usage_daily_counters_scope`

Ownership:
- Billing usage accounting

Dependencies:
- `usage_daily_counters`

Duplicate:
- Same logic later appears in `bugfix.sql`

### 017_organizations_billing_security_indexes

Files:
- `017_organizations_billing_security_indexes.up.sql`
- `017_organizations_billing_security_indexes.down.sql`

Execution order: 17

Creates:
- `uq_org_invitations_pending_email_hash`
- `uq_org_invitations_pending_token_hash`
- `uq_org_api_keys_hash`
- `uq_scim_tokens_active_hash`
- `uq_sso_providers_active_domain_type`

Ownership:
- Mixed: org invites, API keys, SCIM, SSO security hardening

Dependencies:
- Organization security objects

### 018_backpressure_gauge

Files:
- `018_backpressure_gauge.up.sql`
- `018_backpressure_gauge.down.sql`

Execution order: 18

Creates:
- Table `backpressure_gauge`
- Index `idx_backpressure_gauge_updated`

Ownership:
- Monitoring / ingestion operations shared infrastructure

Dependencies:
- None significant

### 019_enterprise_auth_scim_schema

Files:
- `019_enterprise_auth_scim_schema.up.sql`
- `019_enterprise_auth_scim_schema.down.sql`

Execution order: 19

Creates:
- Tables: `organization_scim_token_scopes`, `organization_scim_token_ips`, `scim_groups`, `scim_group_memberships`, `saml_sessions`
- Alters: `audit_logs`, `organization_scim_tokens`, `user_sessions`
- New indexes on `organization_scim_tokens`, `audit_logs`, `user_sessions`, `scim_*`, `saml_sessions`

Indexes:
- `organization_scim_token_scopes`: `idx_scim_token_scopes_scope`
- `organization_scim_token_ips`: `idx_scim_token_ips_token`
- `scim_groups`: `idx_scim_groups_org`, `idx_scim_groups_org_external`, `idx_scim_groups_org_display_name`
- `scim_group_memberships`: `idx_scim_group_memberships_user`, `idx_scim_group_memberships_org`, `idx_scim_group_memberships_group`
- `saml_sessions`: `idx_saml_sessions_lookup`, `idx_saml_sessions_session`, `idx_saml_sessions_expiry`, `idx_saml_sessions_provider_session_index`
- `audit_logs`: `idx_audit_actor_type_id_time`, `idx_audit_logs_time_brin`
- `organization_scim_tokens`: `idx_scim_tokens_rotated_from`, `idx_scim_tokens_grace_window`
- `user_sessions`: `idx_user_sessions_sso_provider`

Ownership:
- Mixed: enterprise auth, SCIM/SSO, audit enhancements

Dependencies:
- `organization_scim_tokens`, `organizations`, `users`, `organization_sso_providers`, `user_sessions`, `audit_logs`

### 020_user_preferences_schema

Files:
- `020_user_preferences_schema.up.sql`
- `020_user_preferences_schema.down.sql`

Execution order: 20

Creates:
- Table `user_preferences`
- Trigger `trg_user_preferences_updated_at` using shared function `set_updated_at`

Constraints and foreign keys:
- `user_id` -> `users`
- `default_org_id` -> `organizations`

Ownership:
- User preferences, likely auth/account domain

Dependencies:
- `users`, `organizations`, shared `set_updated_at`

Rollback:
- `down.sql` is minimal.

### 021_projects_remove_blocked_event_types

Files:
- `021_projects_remove_blocked_event_types.up.sql`
- `021_projects_remove_blocked_event_types.down.sql`

Execution order: 21

Creates/alters:
- Drops `blocked_event_types` from `projects` and `project_environments`

Ownership:
- Projects configuration cleanup

Dependencies:
- `project_environments` must exist, but that table was not observed in `008`

Risk:
- Indicates either hidden project environment creation elsewhere or migration drift.

### 022_alerting_tenant_isolation_cleanup

Files:
- `022_alerting_tenant_isolation_cleanup.up.sql`
- `022_alerting_tenant_isolation_cleanup.down.sql`

Execution order: 22

Creates/alters:
- Backfills `notification_routes.project_id`, `notification_deliveries.project_id`, `notification_dead_letter.project_id`
- Leaves `connector_audit_logs.project_id` nullable by design
- Adds unique index `idx_project_members_project_user_unique` if missing
- Replaces direct user/project FKs on `project_member_alert_preferences` with composite FK to `project_members(project_id, user_id)`
- Drops dead-code table `project_alert_routes`

Ownership:
- Mixed: notifications, project membership, alerting tenant isolation

Dependencies:
- `notification_routes`, `notification_deliveries`, `notification_dead_letter`, `connector_audit_logs`, `project_member_alert_preferences`, `project_members`

Risk:
- This is a data backfill plus model rewrite; it should not live as a generic alerting cleanup file.

### 023_project_alerting_hardening

Files:
- `023_project_alerting_hardening.up.sql`
- `023_project_alerting_hardening.down.sql`

Execution order: 23

Creates/alters:
- Adds indexes `idx_deliveries_project_created`, `idx_dead_letter_project_created`, `idx_routes_org_project_active`
- Alters `notification_deliveries`

Ownership:
- Mixed: notifications plus project-aware access patterns

Dependencies:
- Notification tables from `002` and project scoping introduced later

### 027_project_member_roles_and_status

Files:
- `027_project_member_roles_and_status.up.sql`
- `027_project_member_roles_and_status.down.sql`

Execution order: 27

Encoding:
- UTF-16 single-line SQL

Creates/alters:
- Enum `project_member_role`
- Adds to `project_members`: `role`, `organization_id`, `invited_by`, `invited_at`, `joined_at`, `status`, `updated_at`
- Backfills `organization_id` from `projects`
- Adds indexes `idx_project_members_project_user_unique`, `idx_project_members_org_user`, `idx_project_members_role`, `idx_project_members_status`

Ownership:
- Projects membership

Dependencies:
- `project_members`, `projects`, `organizations`, `users`

Risk:
- Tooling readability and diff safety due to UTF-16 and one-line formatting.

### 028_project_api_keys

Files:
- `028_project_api_keys.up.sql`
- `028_project_api_keys.down.sql`

Execution order: 28

Encoding:
- UTF-16 single-line SQL

Creates/alters:
- Adds to `project_api_keys`: `organization_id`, `scopes`
- Backfills `organization_id` from `projects`
- Adds index `idx_api_keys_org`

Ownership:
- Project API keys

Dependencies:
- `project_api_keys`, `projects`, `organizations`

### 029_project_settings

Files:
- `029_project_settings.up.sql`
- `029_project_settings.down.sql`

Execution order: 29

Encoding:
- UTF-16 single-line SQL

Creates:
- Table `project_settings`
- Indexes `idx_project_settings_project`, `idx_project_settings_org`
- Table comment

Ownership:
- Project settings

Dependencies:
- `projects`, `organizations`

### 030_project_usage_tables

Files:
- `030_project_usage_tables.up.sql`
- `030_project_usage_tables.down.sql`

Execution order: 30

Creates:
- Partitioned table `project_usage_hourly`
- Partitions `project_usage_hourly_y2026m07`, `project_usage_hourly_y2026m08`
- Table `project_usage_daily`
- Comments on usage tables

Indexes:
- `idx_usage_hourly_project_bucket`, `idx_usage_hourly_org_bucket`, `idx_usage_daily_project_date`, `idx_usage_daily_org_date`

Ownership:
- Mixed: project analytics usage warehouse plus time-partition operational bootstrap

Dependencies:
- `projects`, `organizations`

Risk:
- Hard-coded partition months make bootstrap stale over time.

### 031_audit_logs_enhancement

Files:
- `031_audit_logs_enhancement.up.sql`
- `031_audit_logs_enhancement.down.sql`

Execution order: 31

Creates/alters:
- Adds `organization_id`, `project_id`, `actor_id`, `actor_type`, `resource_type`, `resource_id`, `payload` to `audit_logs`
- Adds indexes `idx_audit_logs_org`, `idx_audit_logs_project`, `idx_audit_logs_action`, `idx_audit_logs_created_at`

Ownership:
- Mixed: shared audit infrastructure plus org/project references

Dependencies:
- `audit_logs`, `organizations`, `projects`, `users`

Risk:
- `audit_logs` was originally created in auth; this confirms it should be extracted to a shared/audit domain.

### Helper / Non-Migration Files

#### README.md
- Documents `migrations2` as the authoritative chain.
- Evidence that only `*.up.sql` are meant to be applied.

#### bugfix.sql
- Duplicates `016_billing_allow_org_level_usage.up.sql` logic.
- Not safely part of migration history.

#### index.sql
- Adds `idx_linked_identities_provider_subject_active` on `user_linked_identities`.
- This index belongs with auth identity linking, not as a loose helper file.

## 3. Domain Ownership Matrix

### Shared
- `pgcrypto` extension
- `timescaledb` extension
- `set_updated_at`
- `update_updated_at_column`
- `connector_set_updated_at`
- generic updated-at triggers

### Auth
- `users`
- `user_sessions`
- `user_mfa_devices`
- `email_verifications`
- `email_mfa_otps`
- `sms_mfa_otps`
- `user_trusted_devices`
- `user_linked_identities`
- `auth_email_outbox`
- `saml_sessions`

### Audit
- `audit_logs`
- `organization_audit_logs`
- `connector_audit_logs`

### Security
- `security_events`
- `organization_security_events`

### Organizations
- `organizations`
- `organization_settings`
- `organization_members`
- `organization_invitations`
- `organization_environments`
- `quota_requests`

### Org Identity / Enterprise Access
- `organization_sso_providers`
- `organization_scim_tokens`
- `organization_scim_token_scopes`
- `organization_scim_token_ips`
- `scim_user_mappings`
- `scim_groups`
- `scim_group_memberships`

### Org API / Credentials
- `organization_api_keys`

### Notifications
- `notification_templates`
- `notification_routes`
- `notification_deliveries`
- `notification_dead_letter`
- `organization_email_outbox`

### Connectors
- `connector_configs`
- `connector_secrets`
- `connector_health_checks`

### Alerting
- `alert_rules`
- `alert_rule_conditions`
- `alert_rule_actions`
- `alert_events`
- `alert_event_history`
- `alert_silences`
- `alert_acknowledgments`
- `alert_escalation_policies`
- `alert_escalation_steps`
- `alert_event_batches`
- `alert_delivery_attempts`
- `alert_templates`
- `alert_routing_rules`
- `alert_rule_executions`
- `alert_metrics`
- `organization_alert_thresholds`
- `project_member_alert_preferences`

### Projects
- `projects`
- `project_members`
- `project_releases`
- `project_settings`

### Project Credentials
- `project_api_keys`

### Remote Config / SDK Config
- `sdk_configs`
- `sdk_config_versions`
- `sdk_config_deployments`
- `sdk_config_field_policies`
- `sdk_config_templates`

### Ingestion Queue
- `ingestion_jobs`
- `ingestion_dead_letter_jobs`
- `ingestion_admin_logs`

### Ingestion Usage
- `project_usage`
- `usage_counter_staging` if defined inside `010`

### Analytics / Observability Raw Events
- `events_errors`
- `events_messages`
- `events_requests`
- `events_spans`
- `events_traces`
- `events_metrics`
- `events_logs`
- `events_profiles`
- `events_cron_checkins`
- `events_replays`

### Analytics Product
- `analytics_hourly_rollup`
- `analytics_daily_rollup`
- `analytics_error_groups`
- `analytics_performance_summary`
- `analytics_user_sessions`
- `analytics_dashboards`
- `analytics_saved_queries`
- `analytics_alerts`
- `project_usage_hourly`
- `project_usage_daily`

### Billing
- `plans`
- `organization_subscriptions`
- `subscription_events`
- `usage_daily_counters`
- `invoices`
- `coupons`
- `coupon_redemptions`

### Monitoring / Operations
- `backpressure_gauge`

### Legacy Compatibility
- `spans`, `traces`, `metrics`, `logs`, `profiles`, `cron_checkins`, `replays`, `messages`, `sdk_sessions`, `ingestion_failures`, `errors`, `requests`, `error_groups`

## 4. Mixed Migration Report

`001_auth_create_core_schema`
- Mixes auth, security events, and shared audit logs.

`002_connectors_create_notification_schema`
- Mixes connectors and notifications.

`003_alerting_create_core_schema`
- Mixes alerting with notification and connector dependencies.

`004_analytics_create_core_schema`
- Mixes raw event ingestion storage with analytics product tables and refresh functions.

`005_auth_extend_mfa_schema`
- Mixes auth MFA tables with organization-level MFA policy columns.

`006_organizations_create_core_schema`
- Mixes organizations, members, invites, quotas, org audit, API keys, SSO/SCIM, security events, org outbox, and alert thresholds.

`008_projects_create_core_schema`
- Mixes projects, project memberships, project API keys, and releases.

`008project_alerting_core_schema.sql`
- Mixes project alert preferences with notifications schema changes and dead-end `project_alert_routes`.

`010_ingestion_create_usage_counters_schema`
- Mixes queue-adjacent ingestion accounting with reporting tables.

`013_platform_backfill_connectors_alerting_foreign_keys`
- Cross-cuts connectors and alerting; should be split by target domain.

`015_billing_create_core_schema`
- Mixes plans, subscriptions, usage accounting, invoices, and coupons.

`017_organizations_billing_security_indexes`
- Mixes org invites, API key security, SCIM token security, and SSO uniqueness.

`019_enterprise_auth_scim_schema`
- Mixes enterprise auth sessions, SCIM, and audit log changes.

`022_alerting_tenant_isolation_cleanup`
- Mixes data backfill, notification route scoping, project membership integrity, and dead table removal.

`023_project_alerting_hardening`
- Mixes notifications indexing with project-scoped access patterns.

`031_audit_logs_enhancement`
- Audit schema changes belong in shared/audit, but the file depends on projects and auth identities.

## 5. Proposed Folder Structure

```text
migrations2/
  00_shared/
    001_enable_pgcrypto.sql
    002_enable_timescaledb.sql
    003_create_set_updated_at.sql
    004_create_update_updated_at_column.sql
    005_create_tombstone_deleted_email.sql

  01_auth/
    001_create_users.sql
    002_create_user_sessions.sql
    003_create_user_mfa_devices.sql
    004_create_email_verifications.sql
    005_create_email_mfa_otps.sql
    006_create_sms_mfa_otps.sql
    007_create_user_trusted_devices.sql
    008_create_user_linked_identities.sql
    009_add_linked_identity_active_lookup_index.sql
    010_create_auth_email_outbox.sql
    011_harden_auth_email_outbox_claiming.sql
    012_create_saml_sessions.sql

  02_organizations/
    001_create_organizations.sql
    002_create_organization_settings.sql
    003_backfill_organization_mfa_policy_columns.sql
    004_create_organization_members.sql
    005_create_organization_invitations.sql
    006_harden_organization_invitation_uniqueness.sql
    007_create_quota_requests.sql
    008_create_organization_environments.sql

  03_org_identity/
    001_create_organization_sso_providers.sql
    002_harden_sso_provider_uniqueness.sql
    003_create_organization_scim_tokens.sql
    004_harden_scim_token_uniqueness.sql
    005_create_scim_token_scopes.sql
    006_create_scim_token_ips.sql
    007_create_scim_user_mappings.sql
    008_create_scim_groups.sql
    009_create_scim_group_memberships.sql
    010_extend_user_sessions_for_sso.sql

  04_projects/
    001_create_projects.sql
    002_create_project_members.sql
    003_add_project_member_roles_and_status.sql
    004_create_project_releases.sql
    005_remove_blocked_event_types.sql
    006_create_project_settings.sql

  05_project_credentials/
    001_create_project_api_keys.sql
    002_extend_project_api_keys_with_org_scope.sql

  06_remote_config/
    001_create_sdk_configs.sql
    002_create_sdk_config_versions.sql
    003_create_sdk_config_deployments.sql
    004_create_sdk_config_field_policies.sql
    005_create_sdk_config_templates.sql

  07_connectors/
    001_create_connector_configs.sql
    002_create_connector_secrets.sql
    003_create_connector_health_checks.sql
    004_create_connector_audit_logs.sql
    005_backfill_connector_org_foreign_keys.sql

  08_notifications/
    001_create_notification_templates.sql
    002_create_notification_routes.sql
    003_create_notification_deliveries.sql
    004_create_notification_dead_letter.sql
    005_add_project_scope_to_notification_routes.sql
    006_add_project_scope_to_notification_deliveries.sql
    007_add_project_scope_to_notification_dead_letter.sql
    008_backfill_notification_project_scope.sql
    009_harden_notification_project_indexes.sql

  09_alerting/
    001_create_alert_rules.sql
    002_create_alert_rule_conditions.sql
    003_create_alert_rule_actions.sql
    004_create_alert_events.sql
    005_create_alert_event_history.sql
    006_create_alert_silences.sql
    007_create_alert_acknowledgments.sql
    008_create_alert_escalation_policies.sql
    009_create_alert_escalation_steps.sql
    010_create_alert_event_batches.sql
    011_create_alert_delivery_attempts.sql
    012_create_alert_templates.sql
    013_create_alert_routing_rules.sql
    014_create_alert_rule_executions.sql
    015_create_alert_metrics.sql
    016_create_project_member_alert_preferences.sql
    017_create_organization_alert_thresholds.sql

  10_audit/
    001_create_audit_logs.sql
    002_enhance_audit_logs_with_actor_and_resource_dimensions.sql
    003_create_organization_audit_logs.sql

  11_security/
    001_create_security_events.sql
    002_create_organization_security_events.sql

  12_billing/
    001_create_plans.sql
    002_create_organization_subscriptions.sql
    003_create_subscription_events.sql
    004_create_usage_daily_counters.sql
    005_allow_org_level_usage_daily_counters.sql
    006_create_invoices.sql
    007_create_coupons.sql
    008_create_coupon_redemptions.sql

  13_ingestion/
    001_create_ingestion_jobs.sql
    002_create_ingestion_dead_letter_jobs.sql
    003_create_ingestion_admin_logs.sql
    004_create_project_usage_staging.sql
    005_create_project_usage_rollup_function.sql
    006_create_project_usage_table.sql

  14_observability/
    001_create_events_errors.sql
    002_create_events_messages.sql
    003_create_events_requests.sql
    004_create_events_spans.sql
    005_create_events_traces.sql
    006_create_events_metrics.sql
    007_create_events_logs.sql
    008_create_events_profiles.sql
    009_create_events_cron_checkins.sql
    010_create_events_replays.sql

  15_analytics/
    001_create_analytics_hourly_rollup.sql
    002_create_analytics_daily_rollup.sql
    003_create_analytics_error_groups.sql
    004_create_analytics_performance_summary.sql
    005_create_analytics_user_sessions.sql
    006_create_analytics_dashboards.sql
    007_create_analytics_saved_queries.sql
    008_create_analytics_alerts.sql
    009_create_project_usage_hourly.sql
    010_create_project_usage_daily.sql
    011_create_refresh_hourly_rollup_function.sql

  16_monitoring/
    001_create_backpressure_gauge.sql

  17_legacy_compat/
    001_create_legacy_spans.sql
    002_create_legacy_traces.sql
    003_create_legacy_metrics.sql
    004_create_legacy_logs.sql
    005_create_legacy_profiles.sql
    006_create_legacy_cron_checkins.sql
    007_create_legacy_replays.sql
    008_create_legacy_messages.sql
    009_create_legacy_sdk_sessions.sql
    010_create_legacy_ingestion_failures.sql
    011_create_legacy_errors.sql
    012_create_legacy_requests.sql
    013_create_legacy_error_groups.sql
```

Why each folder exists:
- `00_shared`: global extensions and reusable functions with no business owner.
- `01_auth`: user identity, session, MFA, and auth-delivery mechanics.
- `02_organizations`: org core model and governance.
- `03_org_identity`: enterprise SSO and SCIM lifecycle.
- `04_projects`: project lifecycle and membership.
- `05_project_credentials`: isolated project key ownership.
- `06_remote_config`: SDK / remote config model.
- `07_connectors`: connector configuration and connector-side audit.
- `08_notifications`: templates, routes, deliveries, DLQ.
- `09_alerting`: alert rules, eventing, escalation, and alert preferences.
- `10_audit`: cross-platform audit trail.
- `11_security`: user and org security event streams.
- `12_billing`: plan, subscription, invoicing, coupon, and usage billing.
- `13_ingestion`: queueing and usage rollup ingestion mechanics.
- `14_observability`: raw telemetry event storage.
- `15_analytics`: rollups, dashboards, and product-facing analytics.
- `16_monitoring`: operational gauges.
- `17_legacy_compat`: explicitly quarantined legacy aliases and compatibility tables.

## 6. Migration Rename Plan

High-signal rename mapping:
- `001_auth_create_core_schema.up.sql` -> split across `00_shared`, `01_auth`, `10_audit`, `11_security`
- `002_connectors_create_notification_schema.up.sql` -> split across `07_connectors` and `08_notifications`
- `003_alerting_create_core_schema.up.sql` -> split into `09_alerting/*`
- `004_analytics_create_core_schema.up.sql` -> split into `14_observability/*` and `15_analytics/*`
- `005_auth_extend_mfa_schema.up.sql` -> `01_auth/006_create_sms_mfa_otps.sql` and `02_organizations/003_backfill_organization_mfa_policy_columns.sql`
- `006_organizations_create_core_schema.up.sql` -> split across `02_organizations`, `03_org_identity`, `05_project_credentials`, `10_audit`, `11_security`, `08_notifications`, `09_alerting`
- `007_organizations_create_sdk_config_schema.up.sql` -> split across `06_remote_config/*`
- `008_projects_create_core_schema.up.sql` -> split across `04_projects/*` and `05_project_credentials/001_create_project_api_keys.sql`
- `008project_alerting_core_schema.sql` -> `09_alerting/016_create_project_member_alert_preferences.sql` plus `08_notifications/005-008`
- `009_ingestion_create_queue_schema.up.sql` -> split across `13_ingestion/001-003`
- `010_ingestion_create_usage_counters_schema.up.sql` -> split across `13_ingestion/004-006`
- `011_ingestion_create_legacy_compat_schema.up.sql` -> split across `17_legacy_compat/*`
- `012_auth_harden_email_outbox_schema.up.sql` -> `01_auth/011_harden_auth_email_outbox_claiming.sql`
- `013_platform_backfill_connectors_alerting_foreign_keys.up.sql` -> split into `07_connectors/005...` and alerting-local FK backfills
- `014_organizations_backfill_mfa_policy_columns.up.sql` -> `02_organizations/003_backfill_organization_mfa_policy_columns.sql`
- `015_billing_create_core_schema.up.sql` -> split across `12_billing/*`
- `016_billing_allow_org_level_usage.up.sql` -> `12_billing/005_allow_org_level_usage_daily_counters.sql`
- `017_organizations_billing_security_indexes.up.sql` -> split across `02_organizations`, `03_org_identity`, `05_project_credentials`
- `018_backpressure_gauge.up.sql` -> `16_monitoring/001_create_backpressure_gauge.sql`
- `019_enterprise_auth_scim_schema.up.sql` -> split across `01_auth`, `03_org_identity`, `10_audit`
- `020_user_preferences_schema.up.sql` -> `01_auth/013_create_user_preferences.sql`
- `021_projects_remove_blocked_event_types.up.sql` -> `04_projects/005_remove_blocked_event_types.sql`
- `022_alerting_tenant_isolation_cleanup.up.sql` -> split across `08_notifications/*`, `09_alerting/016...`, `04_projects/003_add_project_member_roles_and_status.sql`
- `023_project_alerting_hardening.up.sql` -> `08_notifications/009_harden_notification_project_indexes.sql`
- `027_project_member_roles_and_status.up.sql` -> `04_projects/003_add_project_member_roles_and_status.sql`
- `028_project_api_keys.up.sql` -> `05_project_credentials/002_extend_project_api_keys_with_org_scope.sql`
- `029_project_settings.up.sql` -> `04_projects/006_create_project_settings.sql`
- `030_project_usage_tables.up.sql` -> `15_analytics/009_create_project_usage_hourly.sql` and `15_analytics/010_create_project_usage_daily.sql`
- `031_audit_logs_enhancement.up.sql` -> `10_audit/002_enhance_audit_logs_with_actor_and_resource_dimensions.sql`
- `bugfix.sql` -> remove after folding into `12_billing/005_allow_org_level_usage_daily_counters.sql`
- `index.sql` -> fold into `01_auth/009_add_linked_identity_active_lookup_index.sql`

## 7. Migration Split Plan

Largest required decompositions:

`001_auth_create_core_schema`
- shared extension/function helpers
- auth user table
- auth sessions
- auth MFA devices
- auth verification tables
- auth outbox
- auth linked identities
- audit logs
- security events

`006_organizations_create_core_schema`
- organizations
- organization settings
- members
- invitations
- quotas
- org audit logs
- environments
- org API keys
- SSO providers
- SCIM tokens
- SCIM user mappings
- org security events
- org email outbox
- org alert thresholds

`003_alerting_create_core_schema`
- rules
- conditions
- actions
- events
- history
- silences
- acknowledgments
- escalation policy
- escalation steps
- event batches
- delivery attempts
- templates
- routing rules
- executions
- metrics

`004_analytics_create_core_schema`
- one migration per `events_*` table family
- one migration per `analytics_*` aggregate/product table
- one migration for partition helper function
- one migration for rollup refresh function

`015_billing_create_core_schema`
- plans
- subscriptions
- subscription events
- usage daily counters
- invoices
- coupons
- coupon redemptions

`011_ingestion_create_legacy_compat_schema`
- split by legacy object family and isolate under `17_legacy_compat`

## 8. Dependency Graph

Recommended top-level order:
1. `00_shared`
2. `01_auth`
3. `02_organizations`
4. `03_org_identity`
5. `04_projects`
6. `05_project_credentials`
7. `06_remote_config`
8. `07_connectors`
9. `08_notifications`
10. `09_alerting`
11. `10_audit`
12. `11_security`
13. `12_billing`
14. `13_ingestion`
15. `14_observability`
16. `15_analytics`
17. `16_monitoring`
18. `17_legacy_compat`

Critical dependencies:
- `organizations` depends on `users` for ownership and membership FKs.
- `projects` depends on `organizations` and `users`.
- `project_api_keys` depends on `projects`, `organizations`.
- `sdk_configs` depends on `organizations`, optionally `projects`.
- connectors and notifications depend on `organizations`, `users`.
- alerting depends on notifications/connectors, `organizations`, `users`.
- billing usage counters depend on `organizations`, optionally `projects`.
- raw observability tables depend on `organizations` and `projects`.
- analytics rollups depend on raw observability tables.
- audit enhancements depend on `users`, `organizations`, `projects`.
- SCIM and SAML depend on organizations and auth sessions.

Observed ordering problems in current chain:
- `005` references `organization_settings` before `006` creates it.
- `021` alters `project_environments`, but that table is not clearly created in the visible chain.
- `008project_alerting_core_schema.sql` is outside formal order, so `022` may depend on changes that are not guaranteed to exist.

Potential circularity to avoid in the redesign:
- Audit should not be required for auth/user bootstrap; keep audit table independent of optional org/project references where possible.
- Alerting preferences should depend on `project_members`, not raw `users` plus `projects` separately, which `022` already moves toward.

## 9. Duplicate & Dead Object Report

Duplicates:
- `pgcrypto` extension creation repeated in many migrations.
- Updated-at helper functions repeated under different names: `set_updated_at`, `update_updated_at_column`, `connector_set_updated_at`.
- `uq_usage_daily_counters_scope` created in both `016_billing_allow_org_level_usage.up.sql` and `bugfix.sql`.
- Auth outbox indexes exist in both `001` and `012`; `012` is a hardening delta and should be preserved as a single focused migration.
- Connector/notification enums recreated in `008project_alerting_core_schema.sql`, despite already existing in `002`.
- Linked identity active lookup index exists only as loose `index.sql`; it duplicates responsibility already owned by auth schema.

Dead or obsolete objects:
- `project_alert_routes`: created in `008project_alerting_core_schema.sql`, dropped in `022`; dead path, remove from clean bootstrap.
- `bugfix.sql`: obsolete once folded into billing migration history.
- `index.sql`: obsolete as a standalone helper once folded into auth migrations.
- Legacy compatibility tables in `011` should remain only if runtime code still queries them; otherwise retire them gradually.

Likely abandoned structure:
- Missing `024-026` suggest deleted or untracked migration history.
- `project_environments` reference in `021` without clear creation path suggests drift or removed source migration.

## 10. Final Migration Mapping

Current to new location summary:
- `001_*` -> `00_shared`, `01_auth`, `10_audit`, `11_security`
- `002_*` -> `07_connectors`, `08_notifications`
- `003_*` -> `09_alerting`
- `004_*` -> `14_observability`, `15_analytics`
- `005_*` -> `01_auth`, `02_organizations`
- `006_*` -> `02_organizations`, `03_org_identity`, `05_project_credentials`, `10_audit`, `11_security`, `08_notifications`, `09_alerting`
- `007_*` -> `06_remote_config`
- `008_projects_*` -> `04_projects`, `05_project_credentials`
- `008project_alerting_core_schema.sql` -> `08_notifications`, `09_alerting`
- `009_*` -> `13_ingestion`
- `010_*` -> `13_ingestion`
- `011_*` -> `17_legacy_compat`
- `012_*` -> `01_auth`
- `013_*` -> `07_connectors`, `08_notifications`, `09_alerting`
- `014_*` -> `02_organizations`
- `015_*` -> `12_billing`
- `016_*` -> `12_billing`
- `017_*` -> `02_organizations`, `03_org_identity`, `05_project_credentials`
- `018_*` -> `16_monitoring`
- `019_*` -> `01_auth`, `03_org_identity`, `10_audit`
- `020_*` -> `01_auth`
- `021_*` -> `04_projects`
- `022_*` -> `08_notifications`, `09_alerting`, `04_projects`
- `023_*` -> `08_notifications`
- `027_*` -> `04_projects`
- `028_*` -> `05_project_credentials`
- `029_*` -> `04_projects`
- `030_*` -> `15_analytics`
- `031_*` -> `10_audit`
- `bugfix.sql` -> remove and fold into `12_billing`
- `index.sql` -> remove and fold into `01_auth`

## 11. Implementation Plan

1. Freeze the current chain and do not edit existing `migrations2` files in place.
2. Build a new bootstrap folder tree beside the current chain, for example `migrations3/`, so history can be recreated from empty DB without replay ambiguity.
3. Extract shared extensions and helper functions first, deduplicating on canonical names.
4. Recreate auth, organizations, projects, connectors, notifications, alerting, billing, ingestion, observability, analytics, monitoring, and legacy compatibility as domain-local numbered chains.
5. Move every data backfill migration into the owning domain and keep data rewrite steps separate from object creation steps.
6. Normalize file encoding to UTF-8 and multiline SQL formatting.
7. Replace loose helpers (`008project_alerting_core_schema.sql`, `bugfix.sql`, `index.sql`) with numbered domain migrations.
8. Validate the clean chain by applying it to an empty database in strict order.
9. Diff the resulting schema against the current `migrations2` bootstrap result.
10. Run application integration tests against the clean bootstrap.
11. Only after schema parity is confirmed, decide whether to keep `migrations2` as historical compatibility or retire it in favor of the new chain.
12. Document object ownership and migration authoring rules:
    - one bounded context per folder
    - one responsibility per file
    - shared helpers only in `00_shared`
    - no helper SQL outside numbered migration pairs
    - no cross-domain creation files
    - backfills must be explicitly named

Validation outcome for the proposed architecture:
- Every table has one clear owner.
- No mixed-responsibility files are required.
- Execution order becomes explicit and reviewable.
- Trigger and FK dependencies become local and auditable.
- Rollback becomes possible at domain granularity.
- Future migrations become easier because new objects have an obvious home.
