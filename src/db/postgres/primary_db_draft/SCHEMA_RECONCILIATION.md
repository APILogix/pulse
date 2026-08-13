# Schema Reconciliation

This baseline is generated from the current canonical migration draft plus historical migrations. It is a fresh-database schema, not a replay of historical patches.

## Audit Summary

- Canonical SQL/MD files read: 267
- Historical SQL files read: 5
- Final tables emitted: 205
- Final indexes emitted: 620
- Final functions emitted: 41
- Final views emitted: 6
- Final triggers emitted: 97

## Mandatory Final Tables

| Table | Domain | Runtime Used | Canonical Source | Migration Source | Final | Final Columns |
| --- | --- | --- | --- | --- | --- | --- |
| addon_prices | Billing | unverified | canonical_migrations_draft/11_billing/addons_prices.sql | none | 07_billing/001_create_addon_prices.sql | id, addon_id, provider, billing_interval, currency, amount_minor, provider_price_id, pricing_model, unit_quantity, unit_label, is_default, starts_at, ends_at, created_at, updated_at |
| addons | Billing | unverified | canonical_migrations_draft/11_billing/addons.sql | none | 07_billing/001_create_addons.sql | id, key, name, description, category, target_module, target_feature_id, available_in_tiers, not_available_in_tiers, is_active, sort_order, metadata, created_at, updated_at |
| ai_model_routes | AI | unverified | canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql | none | 13_ai/001_create_ai_model_routes.sql | route_id, ai_mode, plan, tenant_id, primary_model, fallback_model, temperature, max_tokens, timeout_ms, priority, status, created_at, updated_at |
| ai_prompt_templates | AI | unverified | canonical_migrations_draft/18_ai/010_ai_prompt_templates.up.sql | none | 13_ai/001_create_ai_prompt_templates.sql | template_id, ai_mode, version, template_body, variables, status, created_by, created_at |
| ai_usage_logs | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_ai_usage_logs.sql | id, organization_id, project_id, user_id, occurred_at, feature_key, provider, model, credits_used, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, duration_ms, status, request_id, trace_id, metadata, created_at |
| ai_usage_logs_2026_07 | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_ai_usage_logs_2026_07.sql |  |
| alert_acknowledgments | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_acknowledgments.sql | id, event_id, organization_id, acknowledged_by, acknowledged_at, expires_at, comment, is_active, created_at, updated_at |
| alert_dead_letter_events | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_dead_letter_events.sql | id, organization_id, source_queue, pg_boss_job_id, batch_id, event_ids, job_payload, error_message, status, retry_count, max_retries, last_retry_at, retried_at, discarded_at, discarded_by, metadata, created_at, updated_at |
| alert_delivery_attempts | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_delivery_attempts.sql | id, organization_id, event_id, connector_id, route_id, batch_id, status, request_payload, request_headers, response_payload, response_status_code, error_message, error_details, error_category, latency_ms, retry_count, next_retry_at, max_retries, external_message_id, external_delivery_id, created_at, updated_at |
| alert_escalation_policies | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_escalation_policies.sql | id, organization_id, name, description, repeat_interval_minutes, max_repeats, is_active, created_at, updated_at, deleted_at |
| alert_escalation_steps | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_escalation_steps.sql | id, policy_id, step_number, wait_minutes, connector_ids, route_ids, notify_on_call, custom_message_template, template_id, is_active, created_at, updated_at |
| alert_event_batches | Alerting | unverified | migrations/002_create_all.sql | migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 09_alerting/001_create_alert_event_batches.sql | id, organization_id, status, worker_id, event_count, processed_count, success_count, failure_count, started_at, completed_at, duration_ms, error_message, error_details, retry_count, metadata, created_at, updated_at, event_ids, skipped_count, pg_boss_job_id |
| alert_event_history | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_event_history.sql | id, event_id, organization_id, action, actor_id, actor_type, previous_state, new_state, changes_summary, metadata, created_at |
| alert_events | Alerting | unverified | migrations/002_create_all.sql | migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 09_alerting/001_create_alert_events.sql | id, organization_id, rule_id, status, severity, fingerprint, source, source_id, payload, payload_size_bytes, normalized_payload, group_id, group_key, is_group_parent, parent_event_id, duplicate_count, started_at, ended_at, last_notified_at, next_escalation_at, auto_resolve_at, acknowledged_by, acknowledged_at, acknowledgment_expires_at, resolved_by, resolved_at, resolution_reason, suppressed_by, suppressed_at, suppression_reason, labels, annotations, created_at, updated_at, escalation_policy_id, escalation_step_number, escalation_repeat_count, project_id |
| alert_metrics | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_metrics.sql | id, organization_id, rule_id, metric_type, value, bucket_start, bucket_end, granularity, labels, created_at |
| alert_routing_rules | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_routing_rules.sql | id, organization_id, name, description, priority, conditions, target_connector_ids, target_route_ids, fallback_connector_ids, template_id, is_active, created_at, updated_at, deleted_at |
| alert_rule_actions | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_rule_actions.sql | id, rule_id, action_type, priority, order_index, connector_id, route_id, template_id, escalation_policy_id, throttle_duration_seconds, max_notifications_per_hour, action_conditions, is_active, created_at, updated_at |
| alert_rule_bindings | Alerting | unverified | canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql | none | 09_alerting/001_create_alert_rule_bindings.sql | id, organization_id, rule_id, scope_type, scope_level, project_id, environment, service, endpoint, mode, enabled, priority, severity, cooldown_seconds, deduplication_window_seconds, auto_resolve_after_minutes, evaluation_interval_seconds, consecutive_breaches, threshold_overrides, action_mode, requested_channels, recipient_overrides, escalation_policy_id, notes, created_by, updated_by, created_at, updated_at, deleted_at |
| alert_rule_conditions | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_rule_conditions.sql | id, rule_id, condition_type, condition_group_id, field_path, operator, threshold_value, lookback_minutes, aggregate_function, sub_query, is_required, order_index, created_at, updated_at |
| alert_rule_executions | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_rule_executions.sql | id, organization_id, rule_id, started_at, completed_at, duration_ms, status, matched_count, triggered_count, suppressed_count, error_count, evaluation_data, error_message, created_at |
| alert_rule_revisions | Alerting | unverified | canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql | none | 09_alerting/001_create_alert_rule_revisions.sql | id, organization_id, rule_id, revision, change_kind, snapshot, actor_user_id, created_at |
| alert_rules | Alerting | unverified | migrations/002_create_all.sql | canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.down.sql<br>canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql<br>canonical_migrations_draft/17_enterprise_ingestion/002_alerting_project_scope.up.sql<br>migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 09_alerting/001_create_alert_rules.sql | id, organization_id, name, description, severity, enabled, evaluation_interval_seconds, cooldown_seconds, auto_resolve_after_minutes, deduplication_window_seconds, deduplication_key_template, grouping_enabled, grouping_key_template, grouping_wait_seconds, labels, annotations, metadata, created_by, updated_by, enabled_at, disabled_at, created_at, updated_at, deleted_at, current_revision, project_id, preset_key, is_default, last_evaluated_at |
| alert_silences | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_silences.sql | id, organization_id, rule_id, created_by, comment, starts_at, ends_at, matchers, is_active, expired_at, created_at, updated_at |
| alert_templates | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_templates.sql | id, organization_id, name, template_type, content, variables_schema, default_for_severity, connector_type, is_default, sample_data, created_at, updated_at, deleted_at |
| alert_throttle_windows | Alerting | unverified | migrations/002_create_all.sql | none | 09_alerting/001_create_alert_throttle_windows.sql | id, rule_action_id, window_start, notification_count, last_notified_at, created_at, updated_at |
| alerting_audit_events | Alerting | unverified | canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql | none | 09_alerting/001_create_alerting_audit_events.sql | id, workspace_id, organization_id, event_type, entity_type, entity_id, actor_type, actor_id, provisioning_version, payload, created_at |
| alerting_audit_roots | Alerting | unverified | canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql | none | 09_alerting/001_create_alerting_audit_roots.sql | workspace_id, root_version, created_at, updated_at |
| alerting_dashboard_widgets | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_dashboard_widgets.sql | id, workspace_id, widget_key, display_name, position, configuration, is_visible, created_at, updated_at |
| alerting_entitlements | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_entitlements.sql | workspace_id, organization_id, subscription_id, plan_key, limits, features, source_version, created_at, updated_at |
| alerting_escalation_policies_v2 | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_escalation_policies_v2.sql | id, organization_id, system_key, name, description, acknowledgement_timeout_seconds, repeat_interval_seconds, max_repeats, cancellation_rules, is_default, created_at, updated_at |
| alerting_escalation_steps_v2 | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_escalation_steps_v2.sql | id, policy_id, step_number, wait_seconds, connector_ids, route_ids, notify_on_call, is_active, created_at, updated_at |
| alerting_legacy_mappings | Alerting | unverified | canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql | none | 09_alerting/001_create_alerting_legacy_mappings.sql | id, organization_id, project_id, legacy_source, legacy_source_id, canonical_rule_id, canonical_binding_id, source_revision, source_hash, mapping_status, mapping_error, checkpoint, created_at, updated_at |
| alerting_maintenance_config | Alerting | unverified | canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql | none | 09_alerting/001_create_alerting_maintenance_config.sql | workspace_id, timezone, suppression_enabled, recurring_support_enabled, default_suppression_settings, calendar_metadata, created_at, updated_at |
| alerting_notification_defaults | Alerting | unverified | canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql | none | 09_alerting/001_create_alerting_notification_defaults.sql | workspace_id, email_enabled, digest_enabled, business_hours, quiet_hours, fallback_behavior, created_at, updated_at |
| alerting_policy_catalog | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_policy_catalog.sql | id, organization_id, slug, name, description, category_id, severity, default_threshold, recovery_threshold, cooldown_seconds, evaluation_window_seconds, enabled, is_system, current_version, created_at, updated_at |
| alerting_policy_categories | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_policy_categories.sql | id, organization_id, slug, name, description, sort_order, is_system, created_at, updated_at |
| alerting_policy_versions | Alerting | unverified | migrations/002_create_all_ordered.sql | canonical_migrations_draft/18_alerting_workspace/010_add_subscription_tenant_keys.up.sql | 09_alerting/001_create_alerting_policy_versions.sql | id, organization_id, policy_id, version, definition, created_by, created_at |
| alerting_project_policy_overrides | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_project_policy_overrides.sql | id, organization_id, subscription_id, threshold, cooldown_seconds, channels, severity, maintenance_windows, evaluation_window_seconds, environment, escalation_policy_id, mute_schedule, created_by, updated_by, created_at, updated_at |
| alerting_project_policy_subscriptions | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_project_policy_subscriptions.sql | id, organization_id, project_id, policy_id, state, created_by, updated_by, created_at, updated_at, deleted_at |
| alerting_provider_catalog | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_provider_catalog.sql | id, organization_id, provider_key, display_name, status, capabilities, metadata, created_at, updated_at |
| alerting_routing_defaults | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_routing_defaults.sql | id, organization_id, severity, destination_type, connector_id, route_id, is_enabled, priority, config, created_at, updated_at |
| alerting_saved_views | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_saved_views.sql | id, workspace_id, view_key, name, filters, is_system, created_by, created_at, updated_at |
| alerting_search_index_metadata | Alerting | unverified | canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql | none | 09_alerting/001_create_alerting_search_index_metadata.sql | workspace_id, schema_version, enabled_entities, last_rebuild_at, created_at, updated_at |
| alerting_settings | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_settings.sql | workspace_id, timezone, default_evaluation_window_seconds, default_cooldown_seconds, retention_days, default_severity, default_routing_key, default_escalation_policy_id, maximum_incident_age_seconds, digest_defaults, version, created_at, updated_at |
| alerting_usage_counters | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_usage_counters.sql | workspace_id, organization_id, policies_count, custom_policies_count, project_subscriptions_count, notifications_count, sms_count, connector_deliveries_count, incidents_count, maintenance_windows_count, escalations_count, created_at, updated_at |
| alerting_workspaces | Alerting | unverified | migrations/002_create_all_ordered.sql | none | 09_alerting/001_create_alerting_workspaces.sql | id, organization_id, version, initialized_by, initialization_version, provisioning_status, completed_at, last_error, created_at, updated_at |
| analytics_alerts | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_alerts.sql | id, organization_id, project_id, name, metric, operator, threshold, window_minutes, notification_channels, is_active, created_by, created_at, updated_at, deleted_at |
| analytics_daily_rollup | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_daily_rollup.sql | id, organization_id, project_id, bucket_date, error_count, message_count, request_count, span_count, trace_count, metric_count, log_count, profile_count, cron_checkin_count, replay_count, error_fatal_count, error_error_count, error_warning_count, error_info_count, error_debug_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count, request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count, active_services, created_at, updated_at |
| analytics_dashboards | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_dashboards.sql | id, organization_id, project_id, name, description, layout, widgets, is_shared, shared_token, created_by, updated_by, created_at, updated_at, deleted_at |
| analytics_error_groups | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_error_groups.sql | id, organization_id, project_id, fingerprint, error_name, message_template, first_seen_at, last_seen_at, total_count, today_count, week_count, month_count, status, assigned_to, services, environments, releases, created_at, updated_at |
| analytics_hourly_rollup | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_hourly_rollup.sql | id, organization_id, project_id, bucket_hour, error_count, message_count, request_count, span_count, trace_count, metric_count, log_count, profile_count, cron_checkin_count, replay_count, error_fatal_count, error_error_count, error_warning_count, error_info_count, error_debug_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count, request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count, active_services, created_at, updated_at |
| analytics_performance_summary | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_performance_summary.sql | id, organization_id, project_id, bucket_date, route, method, p50_latency_ms, p75_latency_ms, p90_latency_ms, p95_latency_ms, p99_latency_ms, request_count, rpm, error_count, error_rate, apdex_score, created_at, updated_at |
| analytics_saved_queries | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_saved_queries.sql | id, organization_id, project_id, name, description, query_type, query_config, visualization_type, visualization_config, created_by, created_at, updated_at, deleted_at |
| analytics_user_sessions | Analytics | unverified | migrations/002_create_all.sql | none | 15_analytics/001_create_analytics_user_sessions.sql | id, organization_id, project_id, session_id, user_id, started_at, ended_at, duration_seconds, event_count, error_count, pages, is_crashed, created_at |
| api_key_usage_minute | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_api_key_usage_minute.sql | api_key_id, project_id, organization_id, environment_id, bucket, event_type, requests, events, errors, latency_ms_p50, latency_ms_p95, latency_ms_p99, rate_limited |
| audit_logs | Security | unverified | migrations/002_create_all.sql | canonical_migrations_draft/09_audit/002_enhance_audit_logs.up.sql<br>migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 16_security/001_create_audit_logs.sql | id, user_id, org_id, impersonated_by, action, resource_type, resource_id, ip_address, user_agent, request_id, metadata, created_at, organization_id, project_id, actor_id, actor_type, payload |
| auth_email_outbox | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_auth_email_outbox.sql | id, to_email, subject, html, text, template_name, template_data, dedupe_key, status, attempts, max_attempts, next_attempt_at, processing_started_at, processing_worker_id, processing_expires_at, last_error, sent_at, failed_at, created_at, updated_at |
| automation_actions | Automation | unverified | canonical_migrations_draft/19_automation/006_automation_actions.sql | none | 14_automation/001_create_automation_actions.sql | id, workflow_id, workflow_version_id, action_key, action_type, integration_key, sort_order, is_enabled, requires_approval, risk_level, timeout_seconds, max_attempts, retry_backoff_seconds, idempotency_key_template, config, metadata, created_at, updated_at, deleted_at |
| automation_approvals | Automation | unverified | canonical_migrations_draft/19_automation/009_automation_approvals.sql | none | 14_automation/001_create_automation_approvals.sql | id, organization_id, workflow_id, run_id, step_id, requested_by, approved_by, rejected_by, status, risk_level, approval_reason, rejection_reason, expires_at, decided_at, request_payload, decision_payload, metadata, created_at, updated_at |
| automation_conditions | Automation | unverified | canonical_migrations_draft/19_automation/005_automation_conditions.sql | none | 14_automation/001_create_automation_conditions.sql | id, workflow_id, workflow_version_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required, metadata, created_at, updated_at, deleted_at |
| automation_template_versions | Automation | unverified | canonical_migrations_draft/19_automation/011_automation_template_versions.sql | none | 14_automation/001_create_automation_template_versions.sql | id, template_id, version, is_current, definition, trigger_summary, condition_summary, action_summary, created_by, published_at, checksum, metadata, created_at |
| automation_templates | Automation | unverified | canonical_migrations_draft/19_automation/010_automation_templates.sql | none | 14_automation/001_create_automation_templates.sql | id, template_key, scope, organization_id, name, description, workflow_type, category, is_active, is_public, is_featured, minimum_plan_tier, required_feature_key, tags, sort_order, metadata, created_at, updated_at, deleted_at |
| automation_triggers | Automation | unverified | canonical_migrations_draft/19_automation/004_automation_triggers.sql | none | 14_automation/001_create_automation_triggers.sql | id, workflow_id, workflow_version_id, trigger_kind, trigger_type, source_module, source_event, schedule_cron, timezone, webhook_secret_hash, is_enabled, dedupe_key_template, cooldown_seconds, config, metadata, created_at, updated_at, deleted_at |
| automation_workflow_versions | Automation | unverified | canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql | none | 14_automation/001_create_automation_workflow_versions.sql | id, workflow_id, version, status, definition, trigger_summary, condition_summary, action_summary, published_by, published_at, checksum, metadata, created_at |
| automation_workflows | Automation | unverified | canonical_migrations_draft/19_automation/002_automation_workflows.sql | canonical_migrations_draft/19_automation/010_automation_templates.sql | 14_automation/001_create_automation_workflows.sql | id, organization_id, project_id, created_by, updated_by, template_id, name, slug, description, workflow_type, scope, status, is_enabled, current_version, last_run_at, next_run_at, timezone, tags, metadata, created_at, updated_at, deleted_at |
| backpressure_gauge | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_backpressure_gauge.sql | id, pending_depth, updated_at, last_worker_id |
| billing_audit_logs | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_billing_audit_logs.sql | id, organization_id, subscription_id, invoice_id, payment_id, coupon_id, actor_type, actor_user_id, action, request_id, correlation_id, trace_id, ip_address, user_agent, previous_state, new_state, metadata, occurred_at |
| billing_audit_logs_2026_07 | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_billing_audit_logs_2026_07.sql |  |
| billing_audit_logs_2026_08 | Billing | unverified | canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql | none | 07_billing/001_create_billing_audit_logs_2026_08.sql |  |
| billing_audit_logs_default | Billing | unverified | canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql | none | 07_billing/001_create_billing_audit_logs_default.sql |  |
| billing_features | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/006_organization_subscriptions.sql<br>canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_billing_features.sql | id, feature_key, feature_name, description, category, value_type, is_billable, is_public, is_deprecated, sort_order, metadata, created_at, updated_at, deleted_at, module, is_module_root, usage_behavior, configuration, visibility |
| billing_webhook_events | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_billing_webhook_events.sql | id, provider, provider_event_id, event_type, organization_id, payload, payload_sha256, signature_verified, api_version, processing_status, retry_count, next_retry_at, processing_started_at, processed_at, processing_duration_ms, request_id, correlation_id, last_error, metadata, received_at, org_id, attempts |
| connector_audit_logs | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_audit_logs.sql | id, organization_id, connector_id, action, actor_id, actor_type, previous_state, new_state, changes_summary, ip_address, user_agent, request_id, created_at |
| connector_audit_logs_default | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_audit_logs_default.sql |  |
| connector_circuit_state | Connector | unverified | canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql | none | 08_connector/001_create_connector_circuit_state.sql | connector_id, state, consecutive_failures, opened_at, half_open_at, last_success_at, last_failure_at, updated_at |
| connector_configs | Connector | unverified | migrations/002_create_all.sql | canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql<br>migrations/003_project_module_refactor.sql | 08_connector/001_create_connector_configs.sql | id, organization_id, provider, name, description, status, is_default, public_config, provider_metadata, supports_rich_formatting, supports_threading, supports_attachments, rate_limit_requests, rate_limit_window_seconds, max_retries, retry_backoff_base_ms, retry_backoff_multiplier, consecutive_failures, failure_threshold, last_health_check_at, last_successful_delivery_at, created_by, updated_by, created_at, updated_at, deleted_at |
| connector_credentials | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_credentials.sql | id, connector_id, credential_type, key_name, encrypted_value, algorithm, version, expires_at, rotated_at, last_used_at, created_by, created_at, updated_at |
| connector_deliveries | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_deliveries.sql | id, organization_id, connector_id, route_id, event_id, alert_id, notification_type, severity, status, http_status, provider_request_id, external_message_id, payload, payload_size_bytes, provider_response, response_body, response_status_code, error_message, error_details, attempts, max_attempts, duration_ms, delivery_latency_ms, retry_count, next_retry_at, scheduled_at, sent_at, failed_at, correlation_id, parent_delivery_id, created_at, updated_at, delivered_at |
| connector_deliveries_default | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_deliveries_default.sql |  |
| connector_delivery_attempts | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_delivery_attempts.sql | id, delivery_id, delivery_created_at, attempt_number, status, http_status, error_code, error_message, response, duration_ms, attempted_at |
| connector_delivery_attempts_default | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_delivery_attempts_default.sql |  |
| connector_health_checks | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_health_checks.sql | id, connector_id, status, http_status, dns_time_ms, tls_time_ms, connect_time_ms, response_time_ms, error_code, error_message, details, checked_at |
| connector_health_checks_default | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_health_checks_default.sql |  |
| connector_oauth_states | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_oauth_states.sql | id, connector_id, state, code_verifier, expires_at, created_at |
| connector_rate_buckets | Connector | unverified | canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql | none | 08_connector/001_create_connector_rate_buckets.sql | connector_id, window_start, window_seconds, consumed, updated_at |
| connector_routes | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_routes.sql | id, connector_id, project_id, environment, event_type, severity, enabled, created_at |
| connector_secret_versions | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_secret_versions.sql | id, credential_id, version, encrypted_value, rotated_by, rotated_at |
| connector_test_runs | Connector | unverified | migrations/002_create_all.sql | none | 08_connector/001_create_connector_test_runs.sql | id, connector_id, triggered_by, status, response, duration_ms, created_at |
| coupon_applicable_plans | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_coupon_applicable_plans.sql | coupon_id, plan_id, created_at |
| coupon_redemptions | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_coupon_redemptions.sql | id, coupon_id, organization_id, subscription_id, invoice_id, redeemed_by, discount_amount, currency, redemption_source, metadata, redeemed_at |
| coupons | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/001_fixed_tables.sql | 07_billing/001_create_coupons.sql | id, code, name, description, discount_type, discount_value, currency, max_redemptions, redemption_count, max_redemptions_per_org, first_time_customers_only, trial_only, valid_from, valid_until, is_active, is_public, metadata, created_at, updated_at, deleted_at |
| credit_balances | Billing | unverified | canonical_migrations_draft/18_ai/002_credit_balances.up.sql | canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql | 07_billing/001_create_credit_balances.sql | owner_type, owner_id, balance, reserved_credits, version, created_at, updated_at, unlimited |
| credit_ledger | Billing | unverified | canonical_migrations_draft/18_ai/003_credit_ledger.up.sql | canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql | 07_billing/001_create_credit_ledger.sql | ledger_id, owner_type, owner_id, request_id, idempotency_key, ai_mode, amount, direction, reason, status, metadata, created_at |
| credit_rules | Billing | unverified | canonical_migrations_draft/18_ai/004_credit_rules.up.sql | none | 07_billing/001_create_credit_rules.sql | rule_id, scope, plan, tenant_id, ai_mode, cost, cached_cost, partial_cost, effective_from, effective_to, priority, status, created_at, updated_at |
| cron_checkins | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_cron_checkins.sql | id, project_id, org_id, monitor_slug, status, duration_ms, environment, timestamp, ingested_at |
| cron_checkins_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_cron_checkins_default.sql |  |
| email_mfa_otps | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_email_mfa_otps.sql | id, user_id, device_id, code_hash, expires_at, used_at, created_at |
| email_verifications | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_email_verifications.sql | id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at |
| error_groups | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_error_groups.sql | id, project_id, fingerprint, first_seen, last_seen, occurrences, last_message, error_type, is_resolved, resolved_at, priority, updated_at |
| errors | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_errors.sql | id, project_id, org_id, message, error_type, fingerprint, severity, stack, context, breadcrumbs, request_id, trace_id, span_id, session_id, resolved_at, resolved_by, timestamp, ingested_at |
| errors_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_errors_default.sql |  |
| events_cron_checkins | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_cron_checkins.sql | id, organization_id, project_id, event_id, monitor_slug, status, duration_ms, environment, trace_id, request_id, service, sdk_name, sdk_version, timestamp, created_at |
| events_errors | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_errors.sql | id, organization_id, project_id, event_id, fingerprint, message, error_name, severity, stack_hash, trace_id, span_id, request_id, session_id, source, mechanism, service, environment, release, server_name, stack_frames, source_context, user_id, user_email, user_ip, breadcrumbs, tags, extra, contexts, sdk_name, sdk_version, timestamp, created_at |
| events_logs | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_logs.sql | id, organization_id, project_id, event_id, level, message, logger, request_id, trace_id, span_id, service, environment, release, tags, context, sdk_name, sdk_version, timestamp, created_at |
| events_messages | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_messages.sql | id, organization_id, project_id, event_id, message, severity, trace_id, span_id, request_id, session_id, service, environment, release, user_id, user_ip, tags, contexts, breadcrumbs, sdk_name, sdk_version, timestamp, created_at |
| events_metrics | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_metrics.sql | id, organization_id, project_id, event_id, metric_name, metric_type, metric_unit, metric_namespace, metric_description, value, unit, tags, attributes, metadata, payload, count, sum, min, max, avg, rate, buckets, p50, p75, p90, p95, p99, metric_category, aggregation_type, temporality, is_monotonic, request_id, session_id, trace_id, span_id, tenant_id, endpoint, http_method, status_code, service, environment, release, application_name, application_version, server_name, sdk_name, sdk_version, timestamp, occurred_at, created_at, ingested_at, ai_response |
| events_profiles | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_profiles.sql | id, organization_id, project_id, event_id, profile_type, format, duration_ms, sample_count, profile, trace_id, span_id, request_id, session_id, service, environment, release, sdk_name, sdk_version, timestamp, created_at |
| events_replays | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_replays.sql | id, organization_id, project_id, event_id, session_id, segment_id, events, trace_id, user_id, service, environment, release, sdk_name, sdk_version, timestamp, created_at |
| events_requests | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_requests.sql | id, organization_id, project_id, event_id, request_id, url, method, status_code, latency_ms, route, framework, headers, query_params, body, body_size, response_size, user_id, tenant_id, session_id, client_ip, user_agent, referer, trace_id, span_id, service, environment, release, is_slow, is_error, sdk_name, sdk_version, timestamp, created_at |
| events_spans | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_spans.sql | id, organization_id, project_id, event_id, span_id, trace_id, parent_span_id, name, span_kind, span_type, span_status, message, start_time, end_time, duration_ms, exclusive_duration_ms, attributes, events, links, db_system, db_name, db_operation, db_collection, db_statement, http_method, http_url, http_status_code, http_host, http_route, messaging_system, messaging_destination, messaging_operation, request_id, session_id, user_id, tenant_id, service, environment, release, sdk_name, sdk_version, timestamp, created_at |
| events_traces | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_events_traces.sql | id, organization_id, project_id, event_id, trace_id, root_span_name, root_span_id, span_count, total_duration_ms, is_partial, spans_tree, request_id, session_id, user_id, tenant_id, service, environment, release, sdk_name, sdk_version, timestamp, created_at |
| feature_dependencies | Security | unverified | canonical_migrations_draft/11_billing/newupdatedfix.sql | none | 16_security/001_create_feature_dependencies.sql | id, feature_id, depends_on_feature_id, dependency_type, created_at |
| feature_flags | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_feature_flags.sql | id, key, scope, scope_id, enabled, payload, description, created_at, updated_at |
| ingestion_admin_logs | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_ingestion_admin_logs.sql | id, log_level, category, message, org_id, project_id, job_id, event_id, worker_id, metadata, created_at |
| ingestion_admin_logs_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_ingestion_admin_logs_default.sql |  |
| ingestion_dead_letter_jobs | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_ingestion_dead_letter_jobs.sql | id, original_job_id, queue, job_type, org_id, project_id, payload, dedupe_key, attempts, max_attempts, last_error, error_code, failed_at, replayed_at, replayed_by, created_at |
| ingestion_failures | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_ingestion_failures.sql | id, project_id, org_id, event_type, reason, detail, raw_excerpt, created_at |
| ingestion_jobs | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_ingestion_jobs.sql | id, queue, job_type, priority, priority_label, org_id, project_id, payload, event_id, trace_id, span_id, session_id, user_id, tenant_id, dedupe_key, state, run_at, attempts, max_attempts, locked_until, locked_by, heartbeat_at, last_error, error_code, processed_by, processing_duration_ms, created_at, updated_at, completed_at |
| invoice_line_items | Billing | unverified | canonical_migrations_draft/11_billing/invoice_line_items.sql | none | 07_billing/001_create_invoice_line_items.sql | id, invoice_id, line_type, description, quantity, unit_amount_minor, amount_minor, plan_id, addon_id, feature_key, metadata, created_at |
| invoices | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/001_fixed_tables.sql | 07_billing/001_create_invoices.sql | id, organization_id, subscription_id, provider, provider_invoice_id, invoice_number, status, currency, subtotal_amount, tax_amount, discount_amount, total_amount, amount_paid, tax_rate, tax_id_snapshot, billing_address_snapshot, period_start, period_end, due_at, paid_at, overage_events, overage_amount, pdf_url, metadata, created_at, updated_at, deleted_at |
| logs | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_logs.sql | id, project_id, org_id, level, message, args, request_id, trace_id, span_id, timestamp, ingested_at |
| logs_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_logs_default.sql |  |
| messages | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_messages.sql | id, project_id, org_id, message, severity, context, breadcrumbs, request_id, trace_id, span_id, timestamp, ingested_at |
| messages_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_messages_default.sql |  |
| metrics | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_metrics.sql | id, project_id, org_id, metric_name, metric_type, value, unit, count, sum, min, max, avg, buckets, tags, timestamp, ingested_at |
| metrics_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_metrics_default.sql |  |
| notification_routes | Notification | unverified | migrations/002_create_all.sql | none | 10_notification/001_create_notification_routes.sql | id, organization_id, name, description, event_types, severity_levels, source_services, target_connector_ids, priority, throttle_window_seconds, max_notifications_per_window, is_active, schedule, created_at, updated_at, deleted_at |
| notification_templates | Notification | unverified | migrations/002_create_all.sql | none | 10_notification/001_create_notification_templates.sql | id, organization_id, name, connector_type, template_format, subject_template, body_template, variables, is_default, created_at, updated_at, deleted_at |
| organization_alert_thresholds | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_alert_thresholds.sql | id, org_id, project_id, p50_threshold_ms, p75_threshold_ms, p90_threshold_ms, p95_threshold_ms, p99_threshold_ms, p50_alert_enabled, p75_alert_enabled, p90_alert_enabled, p95_alert_enabled, p99_alert_enabled, error_rate_threshold_percent, error_rate_alert_enabled, apdex_threshold, apdex_alert_enabled, evaluation_window_minutes, cooldown_minutes, alerts_enabled, notify_emails, last_alerted_at, created_by, created_at, updated_at |
| organization_audit_logs | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_audit_logs.sql | id, org_id, actor_user_id, actor_email, actor_ip, actor_user_agent, actor_session_id, action, entity_type, entity_id, entity_name, request_id, correlation_id, http_method, endpoint, old_values, new_values, changed_fields, status, failure_reason, is_sensitive, metadata, created_at, project_id |
| organization_email_outbox | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_email_outbox.sql | id, org_id, project_id, email_type, to_email, subject, html, text, status, attempts, max_attempts, next_attempt_at, last_error, dedupe_key, metadata, created_at, sent_at |
| organization_feature_overrides | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_organization_feature_overrides.sql | id, organization_id, feature_id, boolean_value, integer_value, decimal_value, string_value, reason, effective_from, expires_at, created_by, approved_by, metadata, created_at, updated_at, deleted_at, configuration |
| organization_invitations | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_invitations.sql | id, org_id, invited_by, email, email_hash, role, token_hash, expires_at, status, accepted_at, accepted_by, declined_at, revoked_at, revoked_by, resent_count, last_resent_at, created_at |
| organization_members | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_members.sql | id, org_id, user_id, role, status, invited_by, invited_at, joined_at, joined_method, last_active_at, deactivated_at, deactivated_by, deactivation_reason, created_at, updated_at |
| organization_scim_token_ips | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_scim_token_ips.sql | token_id, ip_cidr, description, created_at |
| organization_scim_token_scopes | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_scim_token_scopes.sql | token_id, scope |
| organization_scim_tokens | Organization | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/009_extend_organization_scim_tokens_for_rotation.up.sql<br>migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 05_organization/001_create_organization_scim_tokens.sql | id, org_id, token_hash, last_used_at, expires_at, revoked_at, created_by, created_at, rotated_from, rotated_at, grace_period_ends_at |
| organization_security_events | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_security_events.sql | id, org_id, user_id, event_type, severity, ip_address, metadata, created_at |
| organization_settings | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_settings.sql | org_id, enforce_sso, enforce_mfa, session_timeout_minutes, mfa_allowed_methods, mfa_primary_method_preference, mfa_backup_codes_required, mfa_grace_period_days, mfa_max_devices_per_user, mfa_allow_sms_fallback, mfa_allow_email_fallback, mfa_remember_device_days, data_region, data_retention_days, audit_log_retention_days, allow_public_projects, created_at, updated_at |
| organization_sso_providers | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_sso_providers.sql | id, org_id, provider_name, provider_type, entity_id, sso_url, x509_certificate, domain, oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes, oidc_jit_provision, oidc_jit_default_role, is_active, created_at |
| organization_subscriptions | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/001_fixed_tables.sql<br>canonical_migrations_draft/11_billing/006_organization_subscriptions.sql<br>canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_organization_subscriptions.sql | id, organization_id, plan_id, status, provider, billing_interval, provider_customer_id, provider_subscription_id, current_period_start, current_period_end, trial_start, trial_end, cancel_at_period_end, cancelled_at, metadata, created_at, updated_at, deleted_at, modules, performance_class, addons, next_plan_id, entitlement_version, entitlement_snapshot_version, auto_renew |
| organization_usage_current_period | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql<br>canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_organization_usage_current_period.sql | organization_id, subscription_id, period_start, period_end, events_used, ai_credits_used, projects_used, members_used, api_keys_used, connectors_used, alert_rules_used, dashboards_used, event_limit, ai_credit_limit, overage_events, overage_ai_credits, last_event_at, last_ai_request_at, metadata, created_at, updated_at, org_id, events_count, last_incremented_at, alert_notifications_used, connector_sends_used, email_sends_used, slack_sends_used, sms_sends_used, webhook_sends_used, last_alert_notification_at, last_connector_send_at, projects_limit, members_limit, api_keys_limit, connectors_limit, alert_rules_limit, dashboards_limit |
| organization_verified_domains | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_organization_verified_domains.sql | id, organization_id, domain, is_primary, is_verified, auto_join_enabled, verification_method, verification_token, verification_started_at, verified_at, verified_by, last_verification_check_at, metadata, created_at, updated_at, deleted_at |
| organizations | Organization | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/001_fixed_tables.sql | 05_organization/001_create_organizations.sql | id, name, slug, description, logo_url, website_url, industry, company_size, country, timezone, billing_email, support_email, owner_user_id, created_by, status, deleted_at, created_at, updated_at, billing_address, tax_id, tax_id_type |
| payment_methods | Billing | unverified | canonical_migrations_draft/11_billing/payment_methods.sql | none | 07_billing/001_create_payment_methods.sql | id, organization_id, provider, provider_payment_method_id, type, last4, brand, expiry_month, expiry_year, is_default, is_active, billing_details, metadata, created_at, updated_at |
| payments | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_payments.sql | id, organization_id, invoice_id, subscription_id, provider, provider_payment_id, provider_order_id, status, currency, amount, fee_amount, tax_amount, refunded_amount, payment_method, payment_method_last4, initiated_at, authorized_at, captured_at, failed_at, refunded_at, failure_code, failure_reason, idempotency_key, metadata, created_at, updated_at, deleted_at |
| plan_feature_entitlements | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_plan_feature_entitlements.sql | id, plan_id, feature_id, boolean_value, integer_value, decimal_value, string_value, metadata, created_at, updated_at, deleted_at, configuration, display_value |
| plan_prices | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/003_plan_prices.sql | 07_billing/001_create_plan_prices.sql | id, plan_id, provider, billing_interval, currency, amount_minor, provider_price_id, is_default, starts_at, ends_at, metadata, created_at, updated_at, deleted_at, country_code, region_code, tax_behavior, is_promotional |
| plans | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/newupdatedfix.sql | 07_billing/001_create_plans.sql | id, key, version, name, tier, description, trial_days, is_active, is_public, sort_order, created_at, updated_at, deleted_at, is_customizable, next_plan_key, previous_plan_key, badge |
| profiles | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_profiles.sql | id, project_id, org_id, profile_type, start_time, end_time, duration_ms, profile, request_id, trace_id, span_id, timestamp, ingested_at |
| profiles_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_profiles_default.sql |  |
| project_alert_channels | Alerting | unverified | canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql | canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql | 09_alerting/001_create_project_alert_channels.sql | id, organization_id, project_id, connector_id, channel_type, name, description, destination, destination_metadata, is_default, enabled, created_by, updated_by, created_at, updated_at, deleted_at, version |
| project_alert_thresholds | Alerting | unverified | canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql | none | 09_alerting/001_create_project_alert_thresholds.sql | id, organization_id, project_id, environment_id, threshold_key, metric_name, metric_source, category, severity, comparison_operator, threshold_value, threshold_unit, evaluation_window_minutes, cooldown_minutes, consecutive_breaches, enabled, notify_on_recovery, last_triggered_at, last_recovered_at, created_by, updated_by, created_at, updated_at, deleted_at, version |
| project_api_key_rotations | Project | unverified | canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql | canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql | 06_project/001_create_project_api_key_rotations.sql | id, organization_id, project_id, environment_id, old_key_id, new_key_id, state, reason, initiated_by, initiated_at, grace_ends_at, completed_at |
| project_api_keys | Project | unverified | migrations/002_create_all.sql | canonical_migrations_draft/04_projects/009_converge_project_api_keys.up.sql<br>canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql<br>canonical_migrations_draft/04_projects/018_normalize_project_api_keys_and_usage.up.sql<br>canonical_migrations_draft/04_projects/024_update_api_key_public_prefix_constraint.up.sql<br>migrations/003_project_module_refactor.sql | 06_project/001_create_project_api_keys.sql | id, project_id, organization_id, name, description, status, expires_at, last_used_at, created_by, revoked_by, revoked_at, deleted_at, created_at, updated_at, environment_id, public_key, secret_hash, key_type, is_active, rotated_from_key_id, rotated_at, rotated_by, rotation_reason, rotation_state, rotation_version, grace_period_ends_at, revoked_reason, auto_rotate_enabled, auto_rotate_days, last_used_ip, usage_count, error_count, rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, permissions, allowed_endpoints, blocked_endpoints, allowed_sdks, allowed_origins, allowed_ips, allowed_domains, allowed_event_types, metadata, version, sampling_rules, feature_flags, sdk_config |
| project_connector_subscriptions | Connector | unverified | migrations/003_project_module_refactor.sql | canonical_migrations_draft/06_connectors/014_link_project_routing.up.sql | 08_connector/001_create_project_connector_subscriptions.sql | id, project_id, organization_id, connector_id, enabled, alert_categories, severity_threshold, member_ids, channel_overrides, quiet_hours, digest_mode, created_by_user_id, updated_by_user_id, created_at, updated_at, deleted_at, version |
| project_environment_sdk_config_revisions | Project | unverified | canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql | canonical_migrations_draft/04_projects/019_upgrade_environment_sdk_config_snapshot.up.sql<br>canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql<br>canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql | 06_project/001_create_project_environment_sdk_config_revisions.sql | id, config_id, organization_id, project_id, environment_id, revision_number, requested_config, compiled_snapshot, config_hash, schema_version, change_type, change_summary, rolled_back_to_revision, published_by, published_at |
| project_environment_sdk_configs | Project | unverified | canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql | canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql | 06_project/001_create_project_environment_sdk_configs.sql | id, organization_id, project_id, environment_id, published_revision_id, current_revision, current_hash, schema_version, created_by, updated_by, created_at, updated_at, version |
| project_environments | Project | unverified | migrations/003_project_module_refactor.sql | canonical_migrations_draft/04_projects/016_add_environment_runtime_configuration.up.sql<br>canonical_migrations_draft/04_projects/017_simplify_project_environments.up.sql | 06_project/001_create_project_environments.sql | id, project_id, organization_id, name, slug, description, is_default, is_active, color, created_at, updated_at, deleted_at, type |
| project_member_alert_channel_preferences | Alerting | unverified | canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql | canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql | 09_alerting/001_create_project_member_alert_channel_preferences.sql | id, organization_id, project_id, user_id, project_alert_channel_id, category, severity_threshold, enabled, digest_mode, quiet_hours, created_at, updated_at, deleted_at, version |
| project_member_invitations | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_member_invitations.sql | id, project_id, organization_id, email, invited_by_user_id, invited_user_id, role, status, token_hash, expires_at, accepted_at, declined_at, cancelled_at, created_at, updated_at |
| project_member_notification_preferences | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_member_notification_preferences.sql | id, project_id, user_id, channel, category, enabled, severity_threshold, digest_mode, quiet_hours, created_at, updated_at |
| project_members | Project | unverified | migrations/002_create_all.sql | canonical_migrations_draft/04_projects/008_converge_project_members.up.sql<br>migrations/003_project_module_refactor.sql | 06_project/001_create_project_members.sql | id, project_id, user_id, organization_id, role, status, created_by, created_at, updated_at, added_by_user_id, added_at, removed_by_user_id, removed_at, version, role_id |
| project_notification_preferences | Project | unverified | migrations/003_project_module_refactor.sql | canonical_migrations_draft/04_projects/012_create_project_alerting_and_routing.up.sql | 06_project/001_create_project_notification_preferences.sql | id, project_id, organization_id, category, enabled, severity_threshold, connector_ids, member_ids, quiet_hours, digest_mode, escalation_policy_id, created_at, updated_at, default_channel_ids, default_member_ids, role_targets, escalation_policy, deleted_at, version |
| project_releases | Project | unverified | migrations/002_create_all.sql | canonical_migrations_draft/04_projects/007_create_project_environments.up.sql | 06_project/001_create_project_releases.sql | id, project_id, version, commit_sha, branch, released_by, released_at, metadata, organization_id, environment_id, created_at, updated_at |
| project_roles | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_roles.sql | id, project_id, organization_id, name, slug, description, is_system, is_default, permissions, created_at, updated_at |
| project_settings | Project | unverified | migrations/002_create_all.sql | canonical_migrations_draft/04_projects/007_create_project_environments.up.sql | 06_project/001_create_project_settings.sql | id, project_id, organization_id, created_at, updated_at, data_retention_days, sampling_rate, allowed_domains, blocked_domains, pii_scrubbing_enabled, ip_collection_enabled, release_tracking_enabled, session_replay_enabled, performance_monitoring_enabled, error_monitoring_enabled, log_ingestion_enabled, metric_ingestion_enabled, trace_ingestion_enabled, profile_ingestion_enabled, version |
| project_usage | Project | unverified | migrations/002_create_all.sql | none | 06_project/001_create_project_usage.sql | id, project_id, org_id, counter_type, period_start, period_end, value, created_at, updated_at |
| project_usage_daily | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_usage_daily.sql | organization_id, project_id, environment_id, api_key_id, bucket, total_events, errors, requests, transactions, traces, spans, logs, metrics, profiles, ai_events, sdk_requests, active_api_keys, active_environments, active_users, active_members, alert_count, connector_deliveries, failed_notifications, top_endpoints, top_services, top_error_groups, top_sdk_versions, top_countries, top_browsers, top_os, top_devices, top_releases, rate_limit_usage, latency_ms_p50, latency_ms_p95, latency_ms_p99, id, bucket_date, total_bytes, category_counts, event_type_counts, peak_events_per_hour, created_at |
| project_usage_hourly | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_usage_hourly.sql | organization_id, project_id, environment_id, api_key_id, bucket, total_events, errors, requests, transactions, traces, spans, logs, metrics, profiles, ai_events, sdk_requests, active_api_keys, active_environments, active_users, active_members, alert_count, connector_deliveries, failed_notifications, top_endpoints, top_services, top_error_groups, top_sdk_versions, top_countries, top_browsers, top_os, top_devices, top_releases, rate_limit_usage, latency_ms_p50, latency_ms_p95, latency_ms_p99, id, bucket_hour, event_count, event_bytes, category_counts, event_type_counts, created_at |
| project_usage_hourly_default | Project | unverified | migrations/002_create_all.sql | none | 06_project/001_create_project_usage_hourly_default.sql |  |
| project_usage_minute | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_usage_minute.sql | organization_id, project_id, environment_id, api_key_id, bucket, total_events, errors, requests, transactions, traces, spans, logs, metrics, profiles, ai_events, sdk_requests, active_api_keys, active_environments, active_users, active_members, alert_count, connector_deliveries, failed_notifications, top_endpoints, top_services, top_error_groups, top_sdk_versions, top_countries, top_browsers, top_os, top_devices, top_releases, rate_limit_usage, latency_ms_p50, latency_ms_p95, latency_ms_p99 |
| project_usage_monthly | Project | unverified | migrations/003_project_module_refactor.sql | none | 06_project/001_create_project_usage_monthly.sql | organization_id, project_id, year_month, total_events, total_bytes, api_key_requests, rate_limited_events, alert_notifications, active_users |
| projects | Project | unverified | migrations/002_create_all.sql | canonical_migrations_draft/04_projects/007_create_project_environments.up.sql<br>canonical_migrations_draft/04_projects/022_add_project_public_id.sql<br>migrations/003_project_module_refactor.sql | 06_project/001_create_projects.sql | id, org_id, name, slug, description, status, icon, color, created_by, updated_by, archived_at, deleted_at, created_at, updated_at, visibility, timezone, tags, metadata, deleted_by, version, public_id |
| quota_requests | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_quota_requests.sql | id, org_id, quota_type, current_limit, requested_limit, reason, status, reviewed_by, reviewed_at, notes, metadata, created_at, updated_at |
| replays | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_replays.sql | id, project_id, org_id, session_id, segment_id, events, timestamp, ingested_at |
| replays_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_replays_default.sql |  |
| requests | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_requests.sql | id, project_id, org_id, request_id, url, method, status_code, latency_ms, body_size, response_size, user_id, tenant_id, session_id, client_ip, user_agent, referer, route, trace_id, span_id, headers, query, timestamp, ingested_at |
| requests_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_requests_default.sql |  |
| saml_sessions | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_saml_sessions.sql | id, session_id, provider_id, saml_name_id, saml_name_id_format, saml_session_index, issuer, created_at, expires_at |
| scim_group_memberships | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_scim_group_memberships.sql | group_id, user_id, org_id, created_at |
| scim_groups | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_scim_groups.sql | id, org_id, external_id, display_name, meta_version, meta_created, meta_last_modified, active |
| scim_user_mappings | Organization | unverified | migrations/002_create_all.sql | none | 05_organization/001_create_scim_user_mappings.sql | org_id, user_id, external_id, created_at, updated_at |
| sdk_sessions | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_sdk_sessions.sql | id, project_id, org_id, session_id, started_at, last_activity_at, event_count, error_count, crashed, status, timestamp, ingested_at |
| sdk_sessions_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_sdk_sessions_default.sql |  |
| security_events | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_security_events.sql | id, event_type, severity, user_id, ip_address, ip_country, user_agent, device_fingerprint, description, evidence, action_taken, blocked_until, resolved_at, resolved_by, resolution_notes, false_positive, created_at |
| spans | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_spans.sql | id, project_id, org_id, trace_id, span_id, parent_span_id, name, kind, status, status_message, start_time, end_time, duration_ms, exclusive_duration_ms, attributes, events, links, request_id, session_id, user_id, timestamp, ingested_at |
| spans_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_spans_default.sql |  |
| subscription_addons | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/006_organization_subscriptions.sql<br>canonical_migrations_draft/11_billing/008_subscription_addons.sql | 07_billing/001_create_subscription_addons.sql | id, subscription_id, organization_id, feature_id, quantity, starts_at, expires_at, provider, provider_reference, status, metadata, created_at, updated_at, addon_key, module, addon_id |
| subscription_events | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/001_fixed_tables.sql | 07_billing/001_create_subscription_events.sql | id, organization_id, subscription_id, event_type, actor, actor_user_id, old_plan_id, new_plan_id, request_id, correlation_id, metadata, created_at |
| tmp_enterprise_billing_feature_seed | Security | unverified | canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql | none | 16_security/001_create_tmp_enterprise_billing_feature_seed.sql | feature_key, feature_name, description, category, value_type, module, is_module_root, sort_order, free_value, starter_value, growth_value, business_value, enterprise_value, metadata |
| traces | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_traces.sql | id, project_id, org_id, trace_id, root_span, span_count, total_duration_ms, is_partial, root_name, has_error, request_id, session_id, user_id, timestamp, ingested_at |
| traces_default | Observability | unverified | migrations/002_create_all.sql | none | 11_observability/001_create_traces_default.sql |  |
| usage_counter_staging | Usage | unverified | migrations/002_create_all.sql | canonical_migrations_draft/13_ingestion/010_add_usage_counter_staging_dimensions.up.sql | 12_usage/001_create_usage_counter_staging.sql | id, project_id, org_id, counter_type, increment_by, created_at, api_key_id, event_type |
| usage_daily_counters | Billing | unverified | migrations/002_create_all.sql | canonical_migrations_draft/11_billing/042_alert_connector_usage_counters.sql | 07_billing/001_create_usage_daily_counters.sql | id, organization_id, project_id, usage_date, events_count, ai_credits_used, requests_count, errors_count, traces_count, spans_count, metrics_count, logs_count, profiles_count, replays_count, created_at, updated_at, alert_notifications_count, connector_sends_count, email_sends_count, slack_sends_count, sms_sends_count, webhook_sends_count |
| usage_daily_counters_2026_07 | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_usage_daily_counters_2026_07.sql |  |
| usage_daily_counters_default | Billing | unverified | migrations/002_create_all.sql | none | 07_billing/001_create_usage_daily_counters_default.sql |  |
| user_backup_codes | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_user_backup_codes.sql | id, user_id, code_hash, used_at, used_from_ip, created_at |
| user_linked_identities | User | unverified | migrations/002_create_all.sql | none | 04_user/001_create_user_linked_identities.sql | id, user_id, provider, provider_subject, provider_email, profile_metadata, linked_at, last_used_at, revoked_at |
| user_mfa_devices | User | unverified | migrations/002_create_all.sql | canonical_migrations_draft/01_auth/003_create_user_mfa_devices.up.sql<br>migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 04_user/001_create_user_mfa_devices.sql | id, user_id, type, device_type, device_name, secret_encrypted, phone_e164, email, credential_id, public_key, sign_count, is_verified, verified_at, last_used_at, last_used_ip, is_primary, is_active, disabled_at, disabled_reason, device_metadata, created_at, updated_at |
| user_preferences | User | unverified | migrations/002_create_all.sql | canonical_migrations_draft/02_organizations/001_create_organizations.up.sql | 04_user/001_create_user_preferences.sql | user_id, default_org_id, created_at, updated_at |
| user_security_events | User | unverified | canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql | none | 04_user/001_create_user_security_events.sql | id, user_id, event_type, description, device_info, ip_address, location, metadata, created_at |
| user_sessions | User | unverified | migrations/002_create_all.sql | canonical_migrations_draft/03_org_identity/010_extend_user_sessions_for_sso_provider_type.up.sql<br>migrations/002_create_all_ordered.sql<br>migrations/002_create_all.sql | 04_user/001_create_user_sessions.sql | id, user_id, refresh_token_hash, previous_refresh_token_hash, previous_refresh_rotated_at, access_token_jti, device_fingerprint, device_name, device_type, ip_address, ip_geo_country, ip_geo_city, user_agent, created_at, last_active_at, expires_at, absolute_expires_at, status, terminated_at, terminated_by, termination_reason, mfa_verified_at, mfa_expires_at, saml_name_id, saml_session_index, sso_provider_id, sso_provider_type, login_method |
| user_trusted_devices | User | unverified | migrations/002_create_all.sql | canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql | 04_user/001_create_user_trusted_devices.sql | id, user_id, device_fingerprint, device_name, ip_address, user_agent, trusted_at, expires_at, last_seen_at, revoked_at, device_type, os, browser, location, last_used_at |
| users | User | unverified | migrations/002_create_all.sql | canonical_migrations_draft/01_auth/012_personal_account_settings.up.sql<br>canonical_migrations_draft/02_organizations/001_create_organizations.up.sql<br>migrations/002_create_all_ordered.sql | 04_user/001_create_users.sql | id, email, email_hash, original_email, email_verified, email_verified_at, full_name, avatar_url, password_hash, last_password_change, password_history, status, status_reason, is_admin, mfa_enabled, mfa_enforced_at, mfa_backup_codes_generated_at, login_attempts, locked_until, last_login_at, last_login_ip, last_login_user_agent, last_failed_login_at, last_failed_login_ip, timezone, locale, preferred_mfa_method, accepted_terms_at, accepted_terms_version, accepted_privacy_at, accepted_privacy_version, marketing_consent, marketing_consent_updated_at, data_processing_consent, suspended_at, current_org_id, suspended_by, deletion_scheduled_at, deleted_at, deleted_by, deletion_reason, created_at, updated_at, created_by, version, display_name, marketing_emails, product_updates, deletion_requested_at |

## Trigger Inventory

| Trigger | Domain | Table | Function | Source | Included |
| --- | --- | --- | --- | --- | --- |
| auto_revoke_backup_codes | User | user_mfa_devices | revoke_and_regenerate_backup_codes | migrations/002_create_all.sql | yes |
| trg_mfa_devices_updated_at | User | user_mfa_devices | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_user_preferences_updated_at | User | user_preferences | set_updated_at | migrations/002_create_all.sql | yes |
| update_users_updated_at | User | users | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_org_alert_thresholds_updated_at | Organization | organization_alert_thresholds | set_updated_at | migrations/002_create_all.sql | yes |
| trg_org_members_updated_at | Organization | organization_members | set_updated_at | migrations/002_create_all.sql | yes |
| trg_org_settings_updated_at | Organization | organization_settings | set_updated_at | migrations/002_create_all.sql | yes |
| trg_organization_verified_domains_updated_at | Organization | organization_verified_domains | set_updated_at | migrations/002_create_all.sql | yes |
| trg_org_updated_at | Organization | organizations | set_updated_at | migrations/002_create_all.sql | yes |
| trg_quota_requests_updated_at | Organization | quota_requests | set_updated_at | migrations/002_create_all.sql | yes |
| trg_billing_features_updated_at | Billing | billing_features | set_updated_at | migrations/002_create_all.sql | yes |
| trg_coupons_updated_at | Billing | coupons | set_updated_at | migrations/002_create_all.sql | yes |
| trg_credit_balances_updated_at | Billing | credit_balances | set_updated_at | canonical_migrations_draft/18_ai/002_credit_balances.up.sql | yes |
| trg_credit_ledger_append_only | Billing | credit_ledger | credit_ledger_append_only | canonical_migrations_draft/18_ai/003_credit_ledger.up.sql | yes |
| trg_credit_rules_updated_at | Billing | credit_rules | set_updated_at | canonical_migrations_draft/18_ai/004_credit_rules.up.sql | yes |
| trg_invoices_updated_at | Billing | invoices | set_updated_at | migrations/002_create_all.sql | yes |
| trg_organization_feature_overrides_updated_at | Billing | organization_feature_overrides | set_updated_at | migrations/002_create_all.sql | yes |
| trg_organization_subscriptions_updated_at | Billing | organization_subscriptions | set_updated_at | migrations/002_create_all.sql | yes |
| trg_org_usage_current_period_updated_at | Billing | organization_usage_current_period | set_updated_at | migrations/002_create_all.sql | yes |
| trg_payments_updated_at | Billing | payments | set_updated_at | migrations/002_create_all.sql | yes |
| trg_plan_feature_entitlements_updated_at | Billing | plan_feature_entitlements | set_updated_at | migrations/002_create_all.sql | yes |
| trg_plan_prices_updated_at | Billing | plan_prices | set_updated_at | migrations/002_create_all.sql | yes |
| trg_plans_updated_at | Billing | plans | set_updated_at | migrations/002_create_all.sql | yes |
| trg_subscription_addons_updated_at | Billing | subscription_addons | set_updated_at | migrations/002_create_all.sql | yes |
| trg_usage_daily_counters_updated_at | Billing | usage_daily_counters | set_updated_at | migrations/002_create_all.sql | yes |
| trg_project_api_keys_updated_at | Project | project_api_keys | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_api_keys_version | Project | project_api_keys | bump_project_version | migrations/003_project_module_refactor.sql | yes |
| trg_project_environment_sdk_revisions_immutable | Project | project_environment_sdk_config_revisions | reject_sdk_config_revision_update | canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql | yes |
| trg_project_environment_sdk_configs_updated_at | Project | project_environment_sdk_configs | set_updated_at | canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql | yes |
| trg_project_environments_updated_at | Project | project_environments | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_member_invitations_updated_at | Project | project_member_invitations | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_member_notif_prefs_updated_at | Project | project_member_notification_preferences | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_members_updated_at | Project | project_members | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_members_version | Project | project_members | bump_project_version | migrations/003_project_module_refactor.sql | yes |
| trg_project_notif_prefs_updated_at | Project | project_notification_preferences | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_roles_updated_at | Project | project_roles | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_project_usage_updated_at | Project | project_usage | set_updated_at | migrations/002_create_all.sql | yes |
| trg_projects_provision_defaults | Project | projects | provision_project_schema_defaults | canonical_migrations_draft/04_projects/013_configure_project_integrity.up.sql | yes |
| trg_projects_public_id_immutable | Project | projects | fn_prevent_project_public_id_update | canonical_migrations_draft/04_projects/022_add_project_public_id.sql | yes |
| trg_projects_updated_at | Project | projects | set_updated_at | migrations/002_create_all.sql | yes |
| trg_projects_version | Project | projects | bump_project_version | migrations/003_project_module_refactor.sql | yes |
| trg_connector_circuit_state_updated_at | Connector | connector_circuit_state | connector_set_updated_at | canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql | yes |
| trg_connector_rate_buckets_updated_at | Connector | connector_rate_buckets | connector_set_updated_at | canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql | yes |
| trg_project_connector_subs_updated_at | Connector | project_connector_subscriptions | set_updated_at | migrations/003_project_module_refactor.sql | yes |
| trg_notification_routes_updated_at | Notification | notification_routes | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_notification_templates_updated_at | Notification | notification_templates | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_acknowledgments_updated_at | Alerting | alert_acknowledgments | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_dead_letter_events_updated_at | Alerting | alert_dead_letter_events | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_delivery_attempts_updated_at | Alerting | alert_delivery_attempts | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_escalation_policies_updated_at | Alerting | alert_escalation_policies | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_escalation_steps_updated_at | Alerting | alert_escalation_steps | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_event_batches_updated_at | Alerting | alert_event_batches | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_events_updated_at | Alerting | alert_events | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_routing_rules_updated_at | Alerting | alert_routing_rules | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_rule_actions_updated_at | Alerting | alert_rule_actions | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_rule_bindings_updated_at | Alerting | alert_rule_bindings | connector_set_updated_at | canonical_migrations_draft/08_alerting/020_create_alert_rule_bindings.up.sql | yes |
| trg_alert_rule_conditions_updated_at | Alerting | alert_rule_conditions | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_rules_updated_at | Alerting | alert_rules | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_silences_updated_at | Alerting | alert_silences | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_templates_updated_at | Alerting | alert_templates | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alert_throttle_windows_updated_at | Alerting | alert_throttle_windows | connector_set_updated_at | migrations/002_create_all.sql | yes |
| trg_alerting_audit_roots_updated_at | Alerting | alerting_audit_roots | set_updated_at | canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql | yes |
| trg_alerting_dashboard_widgets_updated_at | Alerting | alerting_dashboard_widgets | set_updated_at | canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql | yes |
| trg_alerting_entitlements_updated_at | Alerting | alerting_entitlements | set_updated_at | canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql | yes |
| trg_alerting_escalation_policies_v2_updated_at | Alerting | alerting_escalation_policies_v2 | set_updated_at | canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql | yes |
| trg_alerting_escalation_steps_v2_updated_at | Alerting | alerting_escalation_steps_v2 | set_updated_at | canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql | yes |
| trg_alerting_legacy_mappings_updated_at | Alerting | alerting_legacy_mappings | connector_set_updated_at | canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql | yes |
| trg_alerting_maintenance_config_updated_at | Alerting | alerting_maintenance_config | set_updated_at | canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql | yes |
| trg_alerting_notification_defaults_updated_at | Alerting | alerting_notification_defaults | set_updated_at | canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql | yes |
| trg_alerting_policy_catalog_updated_at | Alerting | alerting_policy_catalog | set_updated_at | canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql | yes |
| trg_alerting_policy_categories_updated_at | Alerting | alerting_policy_categories | set_updated_at | canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql | yes |
| trg_alerting_project_policy_overrides_updated_at | Alerting | alerting_project_policy_overrides | set_updated_at | canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql | yes |
| trg_alerting_project_policy_subscriptions_updated_at | Alerting | alerting_project_policy_subscriptions | set_updated_at | canonical_migrations_draft/18_alerting_workspace/009_create_project_policy_subscriptions.up.sql | yes |
| trg_alerting_provider_catalog_updated_at | Alerting | alerting_provider_catalog | set_updated_at | canonical_migrations_draft/18_alerting_workspace/004_create_alerting_provider_catalog.up.sql | yes |
| trg_alerting_routing_defaults_updated_at | Alerting | alerting_routing_defaults | set_updated_at | canonical_migrations_draft/18_alerting_workspace/002_create_alerting_routing_escalation_config.up.sql | yes |
| trg_alerting_saved_views_updated_at | Alerting | alerting_saved_views | set_updated_at | canonical_migrations_draft/18_alerting_workspace/006_create_alerting_dashboard_and_saved_views.up.sql | yes |
| trg_alerting_search_index_metadata_updated_at | Alerting | alerting_search_index_metadata | set_updated_at | canonical_migrations_draft/18_alerting_workspace/005_create_alerting_audit_and_search_config.up.sql | yes |
| trg_alerting_settings_updated_at | Alerting | alerting_settings | set_updated_at | canonical_migrations_draft/18_alerting_workspace/003_create_alerting_settings.up.sql | yes |
| trg_alerting_usage_counters_updated_at | Alerting | alerting_usage_counters | set_updated_at | canonical_migrations_draft/18_alerting_workspace/007_create_alerting_entitlements_usage_flags.up.sql | yes |
| trg_alerting_workspaces_updated_at | Alerting | alerting_workspaces | set_updated_at | canonical_migrations_draft/18_alerting_workspace/001_create_alerting_workspace_core.up.sql | yes |
| trg_analytics_alerts_updated_at | Analytics | analytics_alerts | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_daily_rollup_updated_at | Analytics | analytics_daily_rollup | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_dashboards_updated_at | Analytics | analytics_dashboards | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_error_groups_updated_at | Analytics | analytics_error_groups | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_hourly_rollup_updated_at | Analytics | analytics_hourly_rollup | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_perf_summary_updated_at | Analytics | analytics_performance_summary | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_saved_queries_updated_at | Analytics | analytics_saved_queries | update_updated_at_column | migrations/002_create_all.sql | yes |
| trg_feature_flags_updated_at | Observability | feature_flags | set_updated_at | migrations/002_create_all.sql | yes |
| trg_ingestion_jobs_updated_at | Observability | ingestion_jobs | set_updated_at | migrations/002_create_all.sql | yes |
| trg_ai_model_routes_updated_at | AI | ai_model_routes | set_updated_at | canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql | yes |
| trg_automation_actions_updated_at | Automation | automation_actions | set_updated_at | canonical_migrations_draft/19_automation/006_automation_actions.sql | yes |
| trg_automation_approvals_updated_at | Automation | automation_approvals | set_updated_at | canonical_migrations_draft/19_automation/009_automation_approvals.sql | yes |
| trg_automation_conditions_updated_at | Automation | automation_conditions | set_updated_at | canonical_migrations_draft/19_automation/005_automation_conditions.sql | yes |
| trg_automation_templates_updated_at | Automation | automation_templates | set_updated_at | canonical_migrations_draft/19_automation/010_automation_templates.sql | yes |
| trg_automation_triggers_updated_at | Automation | automation_triggers | set_updated_at | canonical_migrations_draft/19_automation/004_automation_triggers.sql | yes |
| trg_immutable_published_version | Automation | automation_workflow_versions | trg_fn_immutable_published_version | canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql | yes |
| trg_automation_workflows_updated_at | Automation | automation_workflows | set_updated_at | canonical_migrations_draft/19_automation/002_automation_workflows.sql | yes |

## Historical Migration Normalization

| Historical Migration | Object | Final Location | Normalized? |
| --- | --- | --- | --- |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | set_updated_at | function | yes |
| migrations/002_create_all_ordered.sql | update_updated_at_column | function | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | users | 04_user/001_create_users.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_email_hash | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_status | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_locked | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_is_admin | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_created_cursor | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_deletion_scheduled | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | update_users_updated_at | 04_user/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | user_sessions | 04_user/001_create_user_sessions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_refresh_token | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_previous_refresh_token_unique | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_purge | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sessions_saml_name_id | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all_ordered.sql | idx_mfa_devices_one_primary | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_mfa_devices_user_type | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_mfa_devices_credential_id | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_mfa_devices_phone | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_mfa_devices_email | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | update_updated_at_column | function | yes |
| migrations/002_create_all_ordered.sql | trg_mfa_devices_updated_at | 04_user/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | user_backup_codes | 04_user/001_create_user_backup_codes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_backup_codes_user_unused | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all_ordered.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all_ordered.sql | generate_backup_codes_for_user | function | yes |
| migrations/002_create_all_ordered.sql | revoke_and_regenerate_backup_codes | function | yes |
| migrations/002_create_all_ordered.sql | auto_revoke_backup_codes | 04_user/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | email_verifications | 04_user/001_create_email_verifications.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_verifications_active_token_hash | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_verifications_user_purpose_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_verifications_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | email_mfa_otps | 04_user/001_create_email_mfa_otps.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_mfa_otps_active_device | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_mfa_otps_user | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_mfa_otps_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | security_events | 04_user/001_create_security_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_security_user_time | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_security_open | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_security_ip_time | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | user_trusted_devices | 04_user/001_create_user_trusted_devices.sql | yes |
| migrations/002_create_all_ordered.sql | idx_trusted_devices_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | user_linked_identities | 04_user/001_create_user_linked_identities.sql | yes |
| migrations/002_create_all_ordered.sql | idx_linked_identities_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_linked_identities_provider_subject_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | auth_email_outbox | 04_user/001_create_auth_email_outbox.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_pending | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_processing | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_sent | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_email_dedupe | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | organizations | 05_organization/001_create_organizations.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_slug_active | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_orgs_owner | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_orgs_status | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_org_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | users | 04_user/001_create_users.sql | yes |
| migrations/002_create_all_ordered.sql | idx_users_current_org | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_settings | 05_organization/001_create_organization_settings.sql | yes |
| migrations/002_create_all_ordered.sql | trg_org_settings_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | organization_members | 05_organization/001_create_organization_members.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_members_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_members_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_members_role | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_org_members_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | organization_invitations | 05_organization/001_create_organization_invitations.sql | yes |
| migrations/002_create_all_ordered.sql | idx_unique_active_invite | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_invitations_token | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_invitations_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | quota_requests | 05_organization/001_create_quota_requests.sql | yes |
| migrations/002_create_all_ordered.sql | idx_quota_requests_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_quota_requests_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_audit_logs | 05_organization/001_create_organization_audit_logs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_org_created | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_actor | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_entity | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_action | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_sensitive | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_audit_metadata_gin | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_security_events | 05_organization/001_create_organization_security_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_security_events_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_email_outbox | 05_organization/001_create_organization_email_outbox.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_email_outbox_due | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_email_outbox_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_email_outbox_dedupe | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_alert_thresholds | 05_organization/001_create_organization_alert_thresholds.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_alert_thresholds_scope | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_alert_thresholds_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_org_alert_thresholds_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_verified_domains | 05_organization/001_create_organization_verified_domains.sql | yes |
| migrations/002_create_all_ordered.sql | uq_verified_domain | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_primary_domain | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_verified_domains_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_verified_domains_verified | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_verified_domains_auto_join | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_verified_domains_verification_check | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_verified_domains_metadata | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_organization_verified_domains_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_sso_providers | 05_organization/001_create_organization_sso_providers.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sso_providers_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sso_providers_active_domain_type | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sso_providers_active_entity_id | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_scim_tokens | 05_organization/001_create_organization_scim_tokens.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_tokens_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_tokens_org_token_active | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | scim_user_mappings | 05_organization/001_create_scim_user_mappings.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_user_mappings_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_scim_token_scopes | 05_organization/001_create_organization_scim_token_scopes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_token_scopes_scope | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_scim_token_ips | 05_organization/001_create_organization_scim_token_ips.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_token_ips_token | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | scim_groups | 05_organization/001_create_scim_groups.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_groups_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_groups_org_external | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_groups_org_display_name | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | scim_group_memberships | 05_organization/001_create_scim_group_memberships.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_group_memberships_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_group_memberships_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_group_memberships_group | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | saml_sessions | 05_organization/001_create_saml_sessions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_saml_sessions_lookup | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_saml_sessions_session | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_saml_sessions_expiry | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_saml_sessions_provider_session_index | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | organization_scim_tokens | 05_organization/001_create_organization_scim_tokens.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_tokens_rotated_from | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_scim_tokens_grace_window | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | user_sessions | 04_user/001_create_user_sessions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_user_sessions_sso_provider | 04_user/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | projects | 06_project/001_create_projects.sql | yes |
| migrations/002_create_all_ordered.sql | idx_projects_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_projects_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_projects_cursor | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_projects_archived | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_projects_org_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_projects_updated_at | 06_project/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | project_members | 06_project/001_create_project_members.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_project_user_unique | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_user | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_org_user | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_role | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_members_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | project_releases | 06_project/001_create_project_releases.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_environment | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_version | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_time | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_project_env_time | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_releases_commit | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | project_settings | 06_project/001_create_project_settings.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_settings_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_settings_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | project_api_keys | 06_project/001_create_project_api_keys.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_prefix | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_expiry | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_last_used | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_project_env | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_api_keys_revoked_cleanup | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | connector_configs | 08_connector/001_create_connector_configs.sql | yes |
| migrations/002_create_all_ordered.sql | uq_connector_name_org | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | connector_credentials | 08_connector/001_create_connector_credentials.sql | yes |
| migrations/002_create_all_ordered.sql | connector_secret_versions | 08_connector/001_create_connector_secret_versions.sql | yes |
| migrations/002_create_all_ordered.sql | connector_routes | 08_connector/001_create_connector_routes.sql | yes |
| migrations/002_create_all_ordered.sql | connector_deliveries | 08_connector/001_create_connector_deliveries.sql | yes |
| migrations/002_create_all_ordered.sql | connector_deliveries_default | 08_connector/001_create_connector_deliveries_default.sql | yes |
| migrations/002_create_all_ordered.sql | connector_delivery_attempts | 08_connector/001_create_connector_delivery_attempts.sql | yes |
| migrations/002_create_all_ordered.sql | connector_delivery_attempts_default | 08_connector/001_create_connector_delivery_attempts_default.sql | yes |
| migrations/002_create_all_ordered.sql | connector_health_checks | 08_connector/001_create_connector_health_checks.sql | yes |
| migrations/002_create_all_ordered.sql | connector_health_checks_default | 08_connector/001_create_connector_health_checks_default.sql | yes |
| migrations/002_create_all_ordered.sql | connector_test_runs | 08_connector/001_create_connector_test_runs.sql | yes |
| migrations/002_create_all_ordered.sql | connector_oauth_states | 08_connector/001_create_connector_oauth_states.sql | yes |
| migrations/002_create_all_ordered.sql | connector_audit_logs | 08_connector/001_create_connector_audit_logs.sql | yes |
| migrations/002_create_all_ordered.sql | connector_audit_logs_default | 08_connector/001_create_connector_audit_logs_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_org | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_project | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_provider | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_default | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_last_health | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_connector_last_delivery | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_connector_credential_key | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_credentials_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_credentials_type | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_credentials_expiry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_credentials_last_used | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_secret_versions_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_secret_rotated_at | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_project | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_environment | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_event | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_enabled | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_org_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_alert | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_event | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_next_retry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_correlation | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_payload_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_delivery_response_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_attempt_delivery | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_attempt_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_attempt_time | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_health_connector_recent | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_health_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_health_checked_at | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_test_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_test_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_oauth_state | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_oauth_expiry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_oauth_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_org_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_connector_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_actor | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_request | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_changes_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | create_monthly_partition | 16_security/900_functions.sql | yes |
| migrations/002_create_all_ordered.sql | create_future_monthly_partitions | function | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | notification_templates | 10_notification/001_create_notification_templates.sql | yes |
| migrations/002_create_all_ordered.sql | uq_template_name_per_org | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_templates_org_type | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_notification_templates_updated_at | 10_notification/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | notification_routes | 10_notification/001_create_notification_routes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_route_name_per_org | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_routes_org_active | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_notification_routes_updated_at | 10_notification/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | alert_rules | 09_alerting/001_create_alert_rules.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alert_rule_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rules_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rules_enabled | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rules_severity | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_rules_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_rule_conditions | 09_alerting/001_create_alert_rule_conditions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_conditions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_conditions_group | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_rule_conditions_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_rule_actions | 09_alerting/001_create_alert_rule_actions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_actions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_actions_connector | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_rule_actions_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_org_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_org_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_fingerprint | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_source | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_group | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_next_escalation | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_auto_resolve | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_events_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_event_history | 09_alerting/001_create_alert_event_history.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_event_history_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_event_history_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alert_silences | 09_alerting/001_create_alert_silences.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_silences_active | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_silences_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_silences_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_acknowledgments | 09_alerting/001_create_alert_acknowledgments.sql | yes |
| migrations/002_create_all_ordered.sql | uq_active_ack_per_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_acks_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_acknowledgments_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_escalation_policies | 09_alerting/001_create_alert_escalation_policies.sql | yes |
| migrations/002_create_all_ordered.sql | uq_escalation_policy_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_escalation_policies_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_escalation_steps | 09_alerting/001_create_alert_escalation_steps.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_escalation_steps_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_escalation_steps_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_event_batches | 09_alerting/001_create_alert_event_batches.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_event_batches_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_event_batches_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_event_batches_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_delivery_attempts | 09_alerting/001_create_alert_delivery_attempts.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_delivery_attempts_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_delivery_attempts_connector | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_delivery_attempts_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_delivery_attempts_batch | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_delivery_attempts_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_templates | 09_alerting/001_create_alert_templates.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alert_template_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_templates_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_templates_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_routing_rules | 09_alerting/001_create_alert_routing_rules.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alert_routing_rule_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_routing_rules_active | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_routing_rules_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_rule_executions | 09_alerting/001_create_alert_rule_executions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_executions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rule_executions_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alert_metrics | 09_alerting/001_create_alert_metrics.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alert_metric_bucket | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_metrics_lookup | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alert_event_batches | 09_alerting/001_create_alert_event_batches.sql | yes |
| migrations/002_create_all_ordered.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | alert_throttle_windows | 09_alerting/001_create_alert_throttle_windows.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_throttle_windows_action | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_throttle_windows_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alert_dead_letter_events | 09_alerting/001_create_alert_dead_letter_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_dead_letter_org_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_dead_letter_retryable | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_alert_dead_letter_events_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_pending_claim | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_stuck_processing | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_expired_ack | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_escalation_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_event_batches_stuck | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_delivery_attempts_org_created | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | audit_logs | 16_security/001_create_audit_logs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_user_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_org_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_action_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_resource | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_request | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_metadata_gin | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | audit_logs | 16_security/001_create_audit_logs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_org | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_project | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_action | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_created_at | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_actor_type_id_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_audit_logs_time_brin | 16_security/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_invitations_pending_email_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_invitations_pending_token_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_scim_tokens_active_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_sso_providers_active_domain_type | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | plans | 07_billing/001_create_plans.sql | yes |
| migrations/002_create_all_ordered.sql | uq_plans_active_key | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plans_active_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plans_tier_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plans_key_version | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plans_public_sort | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_plans_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | plan_prices | 07_billing/001_create_plan_prices.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_provider | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_currency | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_interval | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_lookup | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_plan_prices_default | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_provider_price | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_plan_prices_active_window | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_plan_prices_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | billing_features | 07_billing/001_create_billing_features.sql | yes |
| migrations/002_create_all_ordered.sql | idx_billing_features_category | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_billing_features_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_billing_features_billable | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_billing_features_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | plan_feature_entitlements | 07_billing/001_create_plan_feature_entitlements.sql | yes |
| migrations/002_create_all_ordered.sql | idx_pfe_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_pfe_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_pfe_plan_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_plan_feature_entitlements_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_subscriptions | 07_billing/001_create_organization_subscriptions.sql | yes |
| migrations/002_create_all_ordered.sql | uq_org_single_active_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_provider_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_subscriptions_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_subscriptions_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_subscriptions_period_end | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_subscriptions_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_organization_subscriptions_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | subscription_events | 07_billing/001_create_subscription_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_subscription_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_event | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_actor | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_events_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | subscription_addons | 07_billing/001_create_subscription_addons.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_addons_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_addons_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_addons_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_addons_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_subscription_addons_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_subscription_addons_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_feature_overrides | 07_billing/001_create_organization_feature_overrides.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ofo_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ofo_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ofo_org_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ofo_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ofo_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_organization_feature_overrides_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | organization_usage_current_period | 07_billing/001_create_organization_usage_current_period.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_usage_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_usage_period_end | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_usage_last_event | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_usage_last_ai | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_org_usage_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_org_usage_current_period_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | usage_daily_counters | 07_billing/001_create_usage_daily_counters.sql | yes |
| migrations/002_create_all_ordered.sql | usage_daily_counters_2026_07 | 07_billing/001_create_usage_daily_counters_2026_07.sql | yes |
| migrations/002_create_all_ordered.sql | idx_udc_2026_07_org_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_udc_2026_07_project_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | brin_udc_2026_07_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_usage_daily_counters_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | ai_usage_logs | 07_billing/001_create_ai_usage_logs.sql | yes |
| migrations/002_create_all_ordered.sql | ai_usage_logs_2026_07 | 07_billing/001_create_ai_usage_logs_2026_07.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ai_usage_2026_07_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ai_usage_2026_07_project_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ai_usage_2026_07_user_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ai_usage_2026_07_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | brin_ai_usage_2026_07_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_ai_usage_2026_07_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | invoices | 07_billing/001_create_invoices.sql | yes |
| migrations/002_create_all_ordered.sql | uq_provider_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_invoice_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_invoice_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_invoice_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_invoice_due | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_invoice_period | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_invoice_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_invoices_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | payments | 07_billing/001_create_payments.sql | yes |
| migrations/002_create_all_ordered.sql | idx_payments_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_payments_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_payments_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_payments_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_payments_idempotency | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_payments_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_payments_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | billing_webhook_events | 07_billing/001_create_billing_webhook_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bwe_pending | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bwe_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bwe_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bwe_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bwe_received_brin | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_bwe_payload | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_bwe_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | coupons | 07_billing/001_create_coupons.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupons_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupons_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupons_validity | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupons_redemptions | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_coupons_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_coupons_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | coupon_redemptions | 07_billing/001_create_coupon_redemptions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupon_redemptions_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupon_redemptions_coupon | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupon_redemptions_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_coupon_redemptions_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | brin_coupon_redemptions_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_coupon_redemptions_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | coupon_applicable_plans | 07_billing/001_create_coupon_applicable_plans.sql | yes |
| migrations/002_create_all_ordered.sql | idx_cap_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_cap_coupon | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | billing_audit_logs | 07_billing/001_create_billing_audit_logs.sql | yes |
| migrations/002_create_all_ordered.sql | billing_audit_logs_2026_07 | 07_billing/001_create_billing_audit_logs_2026_07.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bal_2026_07_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bal_2026_07_action | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bal_2026_07_actor | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_bal_2026_07_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | brin_bal_2026_07_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_bal_2026_07_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_bal_2026_07_previous | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | gin_bal_2026_07_new | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | v_effective_entitlements | 16_security/001_views.sql | yes |
| migrations/002_create_all_ordered.sql | v_current_usage | view | yes |
| migrations/002_create_all_ordered.sql | v_subscription_summary | 16_security/001_views.sql | yes |
| migrations/002_create_all_ordered.sql | get_effective_integer_feature | function | yes |
| migrations/002_create_all_ordered.sql | has_feature | function | yes |
| migrations/002_create_all_ordered.sql | remaining_event_quota | function | yes |
| migrations/002_create_all_ordered.sql | remaining_ai_credits | function | yes |
| migrations/002_create_all_ordered.sql | increment_event_usage | function | yes |
| migrations/002_create_all_ordered.sql | consume_ai_credits | function | yes |
| migrations/002_create_all_ordered.sql | backpressure_gauge | 11_observability/001_create_backpressure_gauge.sql | yes |
| migrations/002_create_all_ordered.sql | idx_backpressure_gauge_updated | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | ingestion_jobs | 11_observability/001_create_ingestion_jobs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_claim | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_claim_typed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_lease | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_dedupe | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_org_state | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_event_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_trace_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_jobs_completed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_ingestion_jobs_updated_at | 11_observability/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | ingestion_dead_letter_jobs | 11_observability/001_create_ingestion_dead_letter_jobs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_dlq_queue_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_dlq_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_dlq_unreplayed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_dlq_original_job | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | ingestion_admin_logs | 11_observability/001_create_ingestion_admin_logs.sql | yes |
| migrations/002_create_all_ordered.sql | ingestion_admin_logs_default | 11_observability/001_create_ingestion_admin_logs_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_admin_logs_created | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_admin_logs_category | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_admin_logs_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_admin_logs_level | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_admin_logs_metadata | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | ingestion_queue_snapshot | view | yes |
| migrations/002_create_all_ordered.sql | usage_counter_staging | 12_usage/001_create_usage_counter_staging.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_staging_project | 12_usage/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_staging_flush | 12_usage/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | project_usage | 06_project/001_create_project_usage.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_usage_lookup | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_project_usage_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_project_usage_updated_at | 06_project/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | flush_usage_counters | 16_security/900_functions.sql | yes |
| migrations/002_create_all_ordered.sql | project_usage_realtime | 06_project/001_views.sql | yes |
| migrations/002_create_all_ordered.sql | type | type | yes |
| migrations/002_create_all_ordered.sql | events_errors | 11_observability/001_create_events_errors.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_fingerprint | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_severity | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_service | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_user | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_requests | 11_observability/001_create_events_requests.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_route | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_status | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_slow | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_user | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_spans | 11_observability/001_create_events_spans.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_name | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_db | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_http | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_parent | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_metrics | 11_observability/001_create_events_metrics.sql | yes |
| migrations/002_create_all_ordered.sql | idx_metrics_org_name_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_project_metric_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_project_env_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_name_occurred | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_endpoint_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_http_method_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_metrics_tags | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_events_metrics_attributes_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_metrics_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_messages | 11_observability/001_create_events_messages.sql | yes |
| migrations/002_create_all_ordered.sql | idx_messages_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_messages_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_traces | 11_observability/001_create_events_traces.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_trace_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_logs | 11_observability/001_create_events_logs.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_org_level_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_message | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_profiles | 11_observability/001_create_events_profiles.sql | yes |
| migrations/002_create_all_ordered.sql | idx_profiles_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_profiles_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_cron_checkins | 11_observability/001_create_events_cron_checkins.sql | yes |
| migrations/002_create_all_ordered.sql | idx_crons_org_slug | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_crons_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | events_replays | 11_observability/001_create_events_replays.sql | yes |
| migrations/002_create_all_ordered.sql | idx_replays_org_session | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_replays_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_hourly_rollup | 15_analytics/001_create_analytics_hourly_rollup.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_daily_rollup | 15_analytics/001_create_analytics_daily_rollup.sql | yes |
| migrations/002_create_all_ordered.sql | idx_hourly_rollup_org_hour | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_daily_rollup_org_date | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_hourly_rollup_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | trg_daily_rollup_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | project_usage_hourly | 06_project/001_create_project_usage_hourly.sql | yes |
| migrations/002_create_all_ordered.sql | project_usage_hourly_default | 06_project/001_create_project_usage_hourly_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_hourly_project_bucket | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_hourly_org_bucket | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | project_usage_daily | 06_project/001_create_project_usage_daily.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_daily_project_date | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_usage_daily_org_date | 06_project/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_error_groups | 15_analytics/001_create_analytics_error_groups.sql | yes |
| migrations/002_create_all_ordered.sql | idx_error_groups_org_fingerprint | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_error_groups_org_status | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_error_groups_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_performance_summary | 15_analytics/001_create_analytics_performance_summary.sql | yes |
| migrations/002_create_all_ordered.sql | idx_perf_summary_org_route | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_perf_summary_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_user_sessions | 15_analytics/001_create_analytics_user_sessions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_user_sessions_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_dashboards | 15_analytics/001_create_analytics_dashboards.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_saved_queries | 15_analytics/001_create_analytics_saved_queries.sql | yes |
| migrations/002_create_all_ordered.sql | analytics_alerts | 15_analytics/001_create_analytics_alerts.sql | yes |
| migrations/002_create_all_ordered.sql | idx_dashboards_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_saved_queries_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_analytics_alerts_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_dashboards_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | trg_saved_queries_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | trg_analytics_alerts_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | create_event_partitions | function | yes |
| migrations/002_create_all_ordered.sql | refresh_hourly_rollup | 16_security/900_functions.sql | yes |
| migrations/002_create_all_ordered.sql | spans | 11_observability/001_create_spans.sql | yes |
| migrations/002_create_all_ordered.sql | spans_default | 11_observability/001_create_spans_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_spans_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_spans_parent | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_spans_attrs_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | traces | 11_observability/001_create_traces.sql | yes |
| migrations/002_create_all_ordered.sql | traces_default | 11_observability/001_create_traces_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_unique | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_traces_errors | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | metrics | 11_observability/001_create_metrics.sql | yes |
| migrations/002_create_all_ordered.sql | metrics_default | 11_observability/001_create_metrics_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_metrics_name_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_metrics_tags_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | logs | 11_observability/001_create_logs.sql | yes |
| migrations/002_create_all_ordered.sql | logs_default | 11_observability/001_create_logs_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_level | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_logs_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | profiles | 11_observability/001_create_profiles.sql | yes |
| migrations/002_create_all_ordered.sql | profiles_default | 11_observability/001_create_profiles_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_profiles_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_profiles_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | cron_checkins | 11_observability/001_create_cron_checkins.sql | yes |
| migrations/002_create_all_ordered.sql | cron_checkins_default | 11_observability/001_create_cron_checkins_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_cron_monitor_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | replays | 11_observability/001_create_replays.sql | yes |
| migrations/002_create_all_ordered.sql | replays_default | 11_observability/001_create_replays_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_replays_session | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | messages | 11_observability/001_create_messages.sql | yes |
| migrations/002_create_all_ordered.sql | messages_default | 11_observability/001_create_messages_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_messages_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | sdk_sessions | 11_observability/001_create_sdk_sessions.sql | yes |
| migrations/002_create_all_ordered.sql | sdk_sessions_default | 11_observability/001_create_sdk_sessions_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_sdk_sessions_unique | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | ingestion_failures | 11_observability/001_create_ingestion_failures.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_failures_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_ingestion_failures_reason | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | errors | 11_observability/001_create_errors.sql | yes |
| migrations/002_create_all_ordered.sql | errors_default | 11_observability/001_create_errors_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_errors_fingerprint | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_errors_unresolved | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_errors_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | requests | 11_observability/001_create_requests.sql | yes |
| migrations/002_create_all_ordered.sql | requests_default | 11_observability/001_create_requests_default.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_requests_status | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_requests_latency | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_requests_route | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_legacy_requests_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | error_groups | 11_observability/001_create_error_groups.sql | yes |
| migrations/002_create_all_ordered.sql | idx_error_groups_active | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_errors_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_requests_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_spans_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_metrics_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_messages_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_traces_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_logs_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_profiles_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_cron_checkins_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_events_replays_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alert_rules | 09_alerting/001_create_alert_rules.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rules_org_project | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_rules_eval_due | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alert_rules_preset_scope | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alert_events_org_project_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | feature_flags | 11_observability/001_create_feature_flags.sql | yes |
| migrations/002_create_all_ordered.sql | uq_feature_flags_key_scope | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_feature_flags_scope | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | trg_feature_flags_updated_at | 11_observability/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | usage_daily_counters_default | 07_billing/001_create_usage_daily_counters_default.sql | yes |
| migrations/002_create_all_ordered.sql | user_preferences | 04_user/001_create_user_preferences.sql | yes |
| migrations/002_create_all_ordered.sql | trg_user_preferences_updated_at | 04_user/999_triggers.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_workspaces | 09_alerting/001_create_alerting_workspaces.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_workspaces_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_policy_categories | 09_alerting/001_create_alerting_policy_categories.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_policy_categories_org_order | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_policy_catalog | 09_alerting/001_create_alerting_policy_catalog.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_policy_catalog_org_category | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_policy_catalog_org_severity | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_policy_versions | 09_alerting/001_create_alerting_policy_versions.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_policy_versions_org_created | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_policy_versions_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_routing_defaults | 09_alerting/001_create_alerting_routing_defaults.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_routing_defaults_org_severity | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_escalation_policies_v2 | 09_alerting/001_create_alerting_escalation_policies_v2.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_escalation_policies_org_default | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_escalation_steps_v2 | 09_alerting/001_create_alerting_escalation_steps_v2.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_escalation_steps_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_settings | 09_alerting/001_create_alerting_settings.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_provider_catalog | 09_alerting/001_create_alerting_provider_catalog.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_dashboard_widgets | 09_alerting/001_create_alerting_dashboard_widgets.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_saved_views | 09_alerting/001_create_alerting_saved_views.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_entitlements | 09_alerting/001_create_alerting_entitlements.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_usage_counters | 09_alerting/001_create_alerting_usage_counters.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alerting_policy_catalog_id_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_project_policy_subscriptions | 09_alerting/001_create_alerting_project_policy_subscriptions.sql | yes |
| migrations/002_create_all_ordered.sql | alerting_project_policy_overrides | 09_alerting/001_create_alerting_project_policy_overrides.sql | yes |
| migrations/002_create_all_ordered.sql | uq_alerting_project_policy_subscription_live | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_project_policy_subscriptions_org_project | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_project_policy_subscriptions_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all_ordered.sql | idx_alerting_project_policy_overrides_org_subscription | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | set_updated_at | function | yes |
| migrations/002_create_all.sql | update_updated_at_column | function | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | users | 04_user/001_create_users.sql | yes |
| migrations/002_create_all.sql | idx_users_current_org | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_email_hash | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_status | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_locked | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_is_admin | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_created_cursor | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_users_deletion_scheduled | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | update_users_updated_at | 04_user/999_triggers.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | user_sessions | 04_user/001_create_user_sessions.sql | yes |
| migrations/002_create_all.sql | idx_sessions_refresh_token | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sessions_previous_refresh_token_unique | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sessions_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sessions_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sessions_purge | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sessions_saml_name_id | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all.sql | idx_mfa_devices_one_primary | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_mfa_devices_user_type | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_mfa_devices_credential_id | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_mfa_devices_phone | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_mfa_devices_email | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | update_updated_at_column | function | yes |
| migrations/002_create_all.sql | trg_mfa_devices_updated_at | 04_user/999_triggers.sql | yes |
| migrations/002_create_all.sql | user_backup_codes | 04_user/001_create_user_backup_codes.sql | yes |
| migrations/002_create_all.sql | idx_backup_codes_user_unused | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all.sql | user_mfa_devices | 04_user/001_create_user_mfa_devices.sql | yes |
| migrations/002_create_all.sql | generate_backup_codes_for_user | function | yes |
| migrations/002_create_all.sql | revoke_and_regenerate_backup_codes | function | yes |
| migrations/002_create_all.sql | auto_revoke_backup_codes | 04_user/999_triggers.sql | yes |
| migrations/002_create_all.sql | email_verifications | 04_user/001_create_email_verifications.sql | yes |
| migrations/002_create_all.sql | idx_email_verifications_active_token_hash | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_verifications_user_purpose_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_verifications_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | email_mfa_otps | 04_user/001_create_email_mfa_otps.sql | yes |
| migrations/002_create_all.sql | idx_email_mfa_otps_active_device | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_mfa_otps_user | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_mfa_otps_cleanup | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | security_events | 04_user/001_create_security_events.sql | yes |
| migrations/002_create_all.sql | idx_security_user_time | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_security_open | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_security_ip_time | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | user_trusted_devices | 04_user/001_create_user_trusted_devices.sql | yes |
| migrations/002_create_all.sql | idx_trusted_devices_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | user_linked_identities | 04_user/001_create_user_linked_identities.sql | yes |
| migrations/002_create_all.sql | idx_linked_identities_user_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_linked_identities_provider_subject_active | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | auth_email_outbox | 04_user/001_create_auth_email_outbox.sql | yes |
| migrations/002_create_all.sql | idx_email_pending | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_processing | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_sent | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_sent | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_email_dedupe | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | organizations | 05_organization/001_create_organizations.sql | yes |
| migrations/002_create_all.sql | idx_org_slug_active | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_orgs_owner | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_orgs_status | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_org_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_settings | 05_organization/001_create_organization_settings.sql | yes |
| migrations/002_create_all.sql | trg_org_settings_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | organization_members | 05_organization/001_create_organization_members.sql | yes |
| migrations/002_create_all.sql | idx_org_members_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_members_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_members_role | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_org_members_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | organization_invitations | 05_organization/001_create_organization_invitations.sql | yes |
| migrations/002_create_all.sql | idx_unique_active_invite | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_invitations_token | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_invitations_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | quota_requests | 05_organization/001_create_quota_requests.sql | yes |
| migrations/002_create_all.sql | idx_quota_requests_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_quota_requests_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_audit_logs | 05_organization/001_create_organization_audit_logs.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_org_created | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_actor | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_entity | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_action | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_sensitive | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_audit_metadata_gin | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_security_events | 05_organization/001_create_organization_security_events.sql | yes |
| migrations/002_create_all.sql | idx_org_security_events_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_email_outbox | 05_organization/001_create_organization_email_outbox.sql | yes |
| migrations/002_create_all.sql | idx_org_email_outbox_due | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_email_outbox_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_org_email_outbox_dedupe | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_alert_thresholds | 05_organization/001_create_organization_alert_thresholds.sql | yes |
| migrations/002_create_all.sql | uq_org_alert_thresholds_scope | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_alert_thresholds_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_org_alert_thresholds_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_verified_domains | 05_organization/001_create_organization_verified_domains.sql | yes |
| migrations/002_create_all.sql | uq_verified_domain | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_org_primary_domain | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_verified_domains_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_verified_domains_verified | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_verified_domains_auto_join | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_verified_domains_verification_check | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_verified_domains_metadata | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_organization_verified_domains_updated_at | 05_organization/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_sso_providers | 05_organization/001_create_organization_sso_providers.sql | yes |
| migrations/002_create_all.sql | idx_sso_providers_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sso_providers_active_domain_type | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_sso_providers_active_entity_id | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_scim_tokens | 05_organization/001_create_organization_scim_tokens.sql | yes |
| migrations/002_create_all.sql | idx_scim_tokens_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_tokens_org_token_active | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | scim_user_mappings | 05_organization/001_create_scim_user_mappings.sql | yes |
| migrations/002_create_all.sql | idx_scim_user_mappings_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_scim_token_scopes | 05_organization/001_create_organization_scim_token_scopes.sql | yes |
| migrations/002_create_all.sql | idx_scim_token_scopes_scope | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_scim_token_ips | 05_organization/001_create_organization_scim_token_ips.sql | yes |
| migrations/002_create_all.sql | idx_scim_token_ips_token | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | scim_groups | 05_organization/001_create_scim_groups.sql | yes |
| migrations/002_create_all.sql | idx_scim_groups_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_groups_org_external | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_groups_org_display_name | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | scim_group_memberships | 05_organization/001_create_scim_group_memberships.sql | yes |
| migrations/002_create_all.sql | idx_scim_group_memberships_user | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_group_memberships_org | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_group_memberships_group | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | saml_sessions | 05_organization/001_create_saml_sessions.sql | yes |
| migrations/002_create_all.sql | idx_saml_sessions_lookup | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_saml_sessions_session | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_saml_sessions_expiry | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_saml_sessions_provider_session_index | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | organization_scim_tokens | 05_organization/001_create_organization_scim_tokens.sql | yes |
| migrations/002_create_all.sql | idx_scim_tokens_rotated_from | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_scim_tokens_grace_window | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | user_sessions | 04_user/001_create_user_sessions.sql | yes |
| migrations/002_create_all.sql | idx_user_sessions_sso_provider | 04_user/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | projects | 06_project/001_create_projects.sql | yes |
| migrations/002_create_all.sql | idx_projects_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_projects_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_projects_cursor | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_projects_archived | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_projects_org_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_projects_updated_at | 06_project/999_triggers.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | project_members | 06_project/001_create_project_members.sql | yes |
| migrations/002_create_all.sql | idx_project_members_project_user_unique | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_members_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_members_user | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_members_org_user | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_members_role | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_members_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | project_releases | 06_project/001_create_project_releases.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_environment | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_version | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_time | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_project_env_time | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_releases_commit | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | project_settings | 06_project/001_create_project_settings.sql | yes |
| migrations/002_create_all.sql | idx_project_settings_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_settings_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | project_api_keys | 06_project/001_create_project_api_keys.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_project | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_prefix | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_status | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_expiry | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_last_used | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_project_env | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_api_keys_revoked_cleanup | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | connector_configs | 08_connector/001_create_connector_configs.sql | yes |
| migrations/002_create_all.sql | uq_connector_name_org | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | connector_credentials | 08_connector/001_create_connector_credentials.sql | yes |
| migrations/002_create_all.sql | connector_secret_versions | 08_connector/001_create_connector_secret_versions.sql | yes |
| migrations/002_create_all.sql | connector_routes | 08_connector/001_create_connector_routes.sql | yes |
| migrations/002_create_all.sql | connector_deliveries | 08_connector/001_create_connector_deliveries.sql | yes |
| migrations/002_create_all.sql | connector_deliveries_default | 08_connector/001_create_connector_deliveries_default.sql | yes |
| migrations/002_create_all.sql | connector_delivery_attempts | 08_connector/001_create_connector_delivery_attempts.sql | yes |
| migrations/002_create_all.sql | connector_delivery_attempts_default | 08_connector/001_create_connector_delivery_attempts_default.sql | yes |
| migrations/002_create_all.sql | connector_health_checks | 08_connector/001_create_connector_health_checks.sql | yes |
| migrations/002_create_all.sql | connector_health_checks_default | 08_connector/001_create_connector_health_checks_default.sql | yes |
| migrations/002_create_all.sql | connector_test_runs | 08_connector/001_create_connector_test_runs.sql | yes |
| migrations/002_create_all.sql | connector_oauth_states | 08_connector/001_create_connector_oauth_states.sql | yes |
| migrations/002_create_all.sql | connector_audit_logs | 08_connector/001_create_connector_audit_logs.sql | yes |
| migrations/002_create_all.sql | connector_audit_logs_default | 08_connector/001_create_connector_audit_logs_default.sql | yes |
| migrations/002_create_all.sql | uq_connector_name_org | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_org | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_project | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_provider | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_default | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_last_health | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_connector_last_delivery | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_connector_credential_key | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_credentials_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_credentials_type | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_credentials_expiry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_credentials_last_used | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_secret_versions_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_secret_rotated_at | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_project | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_environment | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_event | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_enabled | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_org_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_alert | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_event | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_next_retry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_correlation | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_lookup | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_payload_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_delivery_response_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_attempt_delivery | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_attempt_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_attempt_time | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_health_connector_recent | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_health_status | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_health_checked_at | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_test_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_test_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_oauth_state | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_oauth_expiry | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_oauth_connector | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_org_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_connector_created | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_actor | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_request | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_changes_gin | 08_connector/900_indexes.sql | yes |
| migrations/002_create_all.sql | create_monthly_partition | 16_security/900_functions.sql | yes |
| migrations/002_create_all.sql | create_future_monthly_partitions | function | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | notification_templates | 10_notification/001_create_notification_templates.sql | yes |
| migrations/002_create_all.sql | uq_template_name_per_org | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_templates_org_type | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_notification_templates_updated_at | 10_notification/999_triggers.sql | yes |
| migrations/002_create_all.sql | notification_routes | 10_notification/001_create_notification_routes.sql | yes |
| migrations/002_create_all.sql | uq_route_name_per_org | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_routes_org_active | 10_notification/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_notification_routes_updated_at | 10_notification/999_triggers.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | alert_rules | 09_alerting/001_create_alert_rules.sql | yes |
| migrations/002_create_all.sql | uq_alert_rule_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rules_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rules_enabled | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rules_severity | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_rules_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_rule_conditions | 09_alerting/001_create_alert_rule_conditions.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_conditions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_conditions_group | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_rule_conditions_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_rule_actions | 09_alerting/001_create_alert_rule_actions.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_actions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_actions_connector | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_rule_actions_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_org_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_org_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_fingerprint | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_source | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_group | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_next_escalation | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_auto_resolve | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_events_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_event_history | 09_alerting/001_create_alert_event_history.sql | yes |
| migrations/002_create_all.sql | idx_alert_event_history_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_event_history_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | alert_silences | 09_alerting/001_create_alert_silences.sql | yes |
| migrations/002_create_all.sql | idx_alert_silences_active | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_silences_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_silences_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_acknowledgments | 09_alerting/001_create_alert_acknowledgments.sql | yes |
| migrations/002_create_all.sql | uq_active_ack_per_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_acks_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_acknowledgments_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_escalation_policies | 09_alerting/001_create_alert_escalation_policies.sql | yes |
| migrations/002_create_all.sql | uq_escalation_policy_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_escalation_policies_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_escalation_steps | 09_alerting/001_create_alert_escalation_steps.sql | yes |
| migrations/002_create_all.sql | idx_alert_escalation_steps_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_escalation_steps_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_event_batches | 09_alerting/001_create_alert_event_batches.sql | yes |
| migrations/002_create_all.sql | idx_alert_event_batches_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_event_batches_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_event_batches_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_delivery_attempts | 09_alerting/001_create_alert_delivery_attempts.sql | yes |
| migrations/002_create_all.sql | idx_alert_delivery_attempts_event | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_delivery_attempts_connector | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_delivery_attempts_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_delivery_attempts_batch | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_delivery_attempts_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_templates | 09_alerting/001_create_alert_templates.sql | yes |
| migrations/002_create_all.sql | uq_alert_template_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_templates_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_templates_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_routing_rules | 09_alerting/001_create_alert_routing_rules.sql | yes |
| migrations/002_create_all.sql | uq_alert_routing_rule_name_per_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_routing_rules_active | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_routing_rules_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_rule_executions | 09_alerting/001_create_alert_rule_executions.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_executions_rule | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rule_executions_org | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | alert_metrics | 09_alerting/001_create_alert_metrics.sql | yes |
| migrations/002_create_all.sql | uq_alert_metric_bucket | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_metrics_lookup | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | alert_event_batches | 09_alerting/001_create_alert_event_batches.sql | yes |
| migrations/002_create_all.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | alert_throttle_windows | 09_alerting/001_create_alert_throttle_windows.sql | yes |
| migrations/002_create_all.sql | idx_alert_throttle_windows_action | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_throttle_windows_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | alert_dead_letter_events | 09_alerting/001_create_alert_dead_letter_events.sql | yes |
| migrations/002_create_all.sql | idx_alert_dead_letter_org_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_dead_letter_retryable | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_alert_dead_letter_events_updated_at | 09_alerting/999_triggers.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_pending_claim | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_stuck_processing | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_expired_ack | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_escalation_policy | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_event_batches_stuck | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_delivery_attempts_org_created | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | audit_logs | 16_security/001_create_audit_logs.sql | yes |
| migrations/002_create_all.sql | idx_audit_user_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_org_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_action_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_resource | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_request | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_metadata_gin | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | audit_logs | 16_security/001_create_audit_logs.sql | yes |
| migrations/002_create_all.sql | idx_audit_logs_org | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_logs_project | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_logs_action | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_logs_created_at | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_actor_type_id_time | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_audit_logs_time_brin | 16_security/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_org_invitations_pending_email_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_org_invitations_pending_token_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_scim_tokens_active_hash | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_sso_providers_active_domain_type | 05_organization/900_indexes.sql | yes |
| migrations/002_create_all.sql | plans | 07_billing/001_create_plans.sql | yes |
| migrations/002_create_all.sql | uq_plans_active_key | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plans_active_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plans_tier_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plans_key_version | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plans_public_sort | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_plans_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | plan_prices | 07_billing/001_create_plan_prices.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_provider | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_currency | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_interval | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_lookup | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_plan_prices_default | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_provider_price | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_plan_prices_active_window | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_plan_prices_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | billing_features | 07_billing/001_create_billing_features.sql | yes |
| migrations/002_create_all.sql | idx_billing_features_category | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_billing_features_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_billing_features_billable | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_billing_features_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | plan_feature_entitlements | 07_billing/001_create_plan_feature_entitlements.sql | yes |
| migrations/002_create_all.sql | idx_pfe_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_pfe_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_pfe_plan_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_plan_feature_entitlements_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_subscriptions | 07_billing/001_create_organization_subscriptions.sql | yes |
| migrations/002_create_all.sql | uq_org_single_active_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_provider_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_subscriptions_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_subscriptions_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_subscriptions_period_end | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_subscriptions_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_organization_subscriptions_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | subscription_events | 07_billing/001_create_subscription_events.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_subscription_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_event | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_actor | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_events_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | subscription_addons | 07_billing/001_create_subscription_addons.sql | yes |
| migrations/002_create_all.sql | idx_subscription_addons_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_addons_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_addons_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_addons_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_subscription_addons_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_subscription_addons_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_feature_overrides | 07_billing/001_create_organization_feature_overrides.sql | yes |
| migrations/002_create_all.sql | idx_ofo_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ofo_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ofo_org_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ofo_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ofo_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_organization_feature_overrides_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | organization_usage_current_period | 07_billing/001_create_organization_usage_current_period.sql | yes |
| migrations/002_create_all.sql | idx_org_usage_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_usage_period_end | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_usage_last_event | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_usage_last_ai | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_org_usage_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_org_usage_current_period_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | usage_daily_counters | 07_billing/001_create_usage_daily_counters.sql | yes |
| migrations/002_create_all.sql | usage_daily_counters_2026_07 | 07_billing/001_create_usage_daily_counters_2026_07.sql | yes |
| migrations/002_create_all.sql | idx_udc_2026_07_org_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_udc_2026_07_project_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | brin_udc_2026_07_date | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_usage_daily_counters_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | ai_usage_logs | 07_billing/001_create_ai_usage_logs.sql | yes |
| migrations/002_create_all.sql | ai_usage_logs_2026_07 | 07_billing/001_create_ai_usage_logs_2026_07.sql | yes |
| migrations/002_create_all.sql | idx_ai_usage_2026_07_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ai_usage_2026_07_project_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ai_usage_2026_07_user_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ai_usage_2026_07_feature | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | brin_ai_usage_2026_07_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_ai_usage_2026_07_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | invoices | 07_billing/001_create_invoices.sql | yes |
| migrations/002_create_all.sql | uq_provider_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_invoice_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_invoice_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_invoice_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_invoice_due | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_invoice_period | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_invoice_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_invoices_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | payments | 07_billing/001_create_payments.sql | yes |
| migrations/002_create_all.sql | idx_payments_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_payments_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_payments_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_payments_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_payments_idempotency | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_payments_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_payments_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | billing_webhook_events | 07_billing/001_create_billing_webhook_events.sql | yes |
| migrations/002_create_all.sql | idx_bwe_pending | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bwe_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bwe_status | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bwe_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bwe_received_brin | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_bwe_payload | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_bwe_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | coupons | 07_billing/001_create_coupons.sql | yes |
| migrations/002_create_all.sql | idx_coupons_active | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupons_public | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupons_validity | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupons_redemptions | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_coupons_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_coupons_updated_at | 07_billing/999_triggers.sql | yes |
| migrations/002_create_all.sql | coupon_redemptions | 07_billing/001_create_coupon_redemptions.sql | yes |
| migrations/002_create_all.sql | idx_coupon_redemptions_org | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupon_redemptions_coupon | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupon_redemptions_subscription | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_coupon_redemptions_invoice | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | brin_coupon_redemptions_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_coupon_redemptions_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | coupon_applicable_plans | 07_billing/001_create_coupon_applicable_plans.sql | yes |
| migrations/002_create_all.sql | idx_cap_plan | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_cap_coupon | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | billing_audit_logs | 07_billing/001_create_billing_audit_logs.sql | yes |
| migrations/002_create_all.sql | billing_audit_logs_2026_07 | 07_billing/001_create_billing_audit_logs_2026_07.sql | yes |
| migrations/002_create_all.sql | idx_bal_2026_07_org_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bal_2026_07_action | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bal_2026_07_actor | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_bal_2026_07_request | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | brin_bal_2026_07_time | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_bal_2026_07_metadata | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_bal_2026_07_previous | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | gin_bal_2026_07_new | 07_billing/900_indexes.sql | yes |
| migrations/002_create_all.sql | v_effective_entitlements | 16_security/001_views.sql | yes |
| migrations/002_create_all.sql | v_current_usage | view | yes |
| migrations/002_create_all.sql | v_subscription_summary | 16_security/001_views.sql | yes |
| migrations/002_create_all.sql | get_effective_integer_feature | function | yes |
| migrations/002_create_all.sql | has_feature | function | yes |
| migrations/002_create_all.sql | remaining_event_quota | function | yes |
| migrations/002_create_all.sql | remaining_ai_credits | function | yes |
| migrations/002_create_all.sql | increment_event_usage | function | yes |
| migrations/002_create_all.sql | consume_ai_credits | function | yes |
| migrations/002_create_all.sql | backpressure_gauge | 11_observability/001_create_backpressure_gauge.sql | yes |
| migrations/002_create_all.sql | idx_backpressure_gauge_updated | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | ingestion_jobs | 11_observability/001_create_ingestion_jobs.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_claim | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_claim_typed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_lease | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_dedupe | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_org_state | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_event_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_trace_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_jobs_completed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_ingestion_jobs_updated_at | 11_observability/999_triggers.sql | yes |
| migrations/002_create_all.sql | ingestion_dead_letter_jobs | 11_observability/001_create_ingestion_dead_letter_jobs.sql | yes |
| migrations/002_create_all.sql | idx_dlq_queue_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_dlq_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_dlq_unreplayed | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_dlq_original_job | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | ingestion_admin_logs | 11_observability/001_create_ingestion_admin_logs.sql | yes |
| migrations/002_create_all.sql | ingestion_admin_logs_default | 11_observability/001_create_ingestion_admin_logs_default.sql | yes |
| migrations/002_create_all.sql | idx_admin_logs_created | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_admin_logs_category | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_admin_logs_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_admin_logs_level | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_admin_logs_metadata | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | ingestion_queue_snapshot | view | yes |
| migrations/002_create_all.sql | usage_counter_staging | 12_usage/001_create_usage_counter_staging.sql | yes |
| migrations/002_create_all.sql | idx_usage_staging_project | 12_usage/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_usage_staging_flush | 12_usage/900_indexes.sql | yes |
| migrations/002_create_all.sql | project_usage | 06_project/001_create_project_usage.sql | yes |
| migrations/002_create_all.sql | idx_project_usage_lookup | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_project_usage_org | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_project_usage_updated_at | 06_project/999_triggers.sql | yes |
| migrations/002_create_all.sql | flush_usage_counters | 16_security/900_functions.sql | yes |
| migrations/002_create_all.sql | project_usage_realtime | 06_project/001_views.sql | yes |
| migrations/002_create_all.sql | type | type | yes |
| migrations/002_create_all.sql | events_errors | 11_observability/001_create_events_errors.sql | yes |
| migrations/002_create_all.sql | idx_errors_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_fingerprint | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_severity | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_service | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_user | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_requests | 11_observability/001_create_events_requests.sql | yes |
| migrations/002_create_all.sql | idx_requests_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_route | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_status | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_slow | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_user | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_spans | 11_observability/001_create_events_spans.sql | yes |
| migrations/002_create_all.sql | idx_spans_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_name | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_db | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_http | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_parent | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_metrics | 11_observability/001_create_events_metrics.sql | yes |
| migrations/002_create_all.sql | idx_metrics_org_name_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_project_metric_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_project_env_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_name_occurred | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_endpoint_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_http_method_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_metrics_tags | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_events_metrics_attributes_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_metrics_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_messages | 11_observability/001_create_events_messages.sql | yes |
| migrations/002_create_all.sql | idx_messages_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_messages_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_traces | 11_observability/001_create_events_traces.sql | yes |
| migrations/002_create_all.sql | idx_traces_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_traces_trace_id | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_traces_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_logs | 11_observability/001_create_events_logs.sql | yes |
| migrations/002_create_all.sql | idx_logs_org_level_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_logs_message | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_logs_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_profiles | 11_observability/001_create_events_profiles.sql | yes |
| migrations/002_create_all.sql | idx_profiles_org_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_profiles_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_cron_checkins | 11_observability/001_create_events_cron_checkins.sql | yes |
| migrations/002_create_all.sql | idx_crons_org_slug | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_crons_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | events_replays | 11_observability/001_create_events_replays.sql | yes |
| migrations/002_create_all.sql | idx_replays_org_session | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_replays_brin_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | analytics_hourly_rollup | 15_analytics/001_create_analytics_hourly_rollup.sql | yes |
| migrations/002_create_all.sql | analytics_daily_rollup | 15_analytics/001_create_analytics_daily_rollup.sql | yes |
| migrations/002_create_all.sql | idx_hourly_rollup_org_hour | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_daily_rollup_org_date | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_hourly_rollup_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | trg_daily_rollup_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | project_usage_hourly | 06_project/001_create_project_usage_hourly.sql | yes |
| migrations/002_create_all.sql | project_usage_hourly_default | 06_project/001_create_project_usage_hourly_default.sql | yes |
| migrations/002_create_all.sql | idx_usage_hourly_project_bucket | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_usage_hourly_org_bucket | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | project_usage_daily | 06_project/001_create_project_usage_daily.sql | yes |
| migrations/002_create_all.sql | idx_usage_daily_project_date | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_usage_daily_org_date | 06_project/900_indexes.sql | yes |
| migrations/002_create_all.sql | analytics_error_groups | 15_analytics/001_create_analytics_error_groups.sql | yes |
| migrations/002_create_all.sql | idx_error_groups_org_fingerprint | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_error_groups_org_status | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_error_groups_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | analytics_performance_summary | 15_analytics/001_create_analytics_performance_summary.sql | yes |
| migrations/002_create_all.sql | idx_perf_summary_org_route | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_perf_summary_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | analytics_user_sessions | 15_analytics/001_create_analytics_user_sessions.sql | yes |
| migrations/002_create_all.sql | idx_user_sessions_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | analytics_dashboards | 15_analytics/001_create_analytics_dashboards.sql | yes |
| migrations/002_create_all.sql | analytics_saved_queries | 15_analytics/001_create_analytics_saved_queries.sql | yes |
| migrations/002_create_all.sql | analytics_alerts | 15_analytics/001_create_analytics_alerts.sql | yes |
| migrations/002_create_all.sql | idx_dashboards_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_saved_queries_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_analytics_alerts_org | 15_analytics/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_dashboards_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | trg_saved_queries_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | trg_analytics_alerts_updated_at | 15_analytics/999_triggers.sql | yes |
| migrations/002_create_all.sql | create_event_partitions | function | yes |
| migrations/002_create_all.sql | refresh_hourly_rollup | 16_security/900_functions.sql | yes |
| migrations/002_create_all.sql | spans | 11_observability/001_create_spans.sql | yes |
| migrations/002_create_all.sql | spans_default | 11_observability/001_create_spans_default.sql | yes |
| migrations/002_create_all.sql | idx_spans_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_parent | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_spans_attrs_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | traces | 11_observability/001_create_traces.sql | yes |
| migrations/002_create_all.sql | traces_default | 11_observability/001_create_traces_default.sql | yes |
| migrations/002_create_all.sql | idx_traces_unique | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_traces_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_traces_errors | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | metrics | 11_observability/001_create_metrics.sql | yes |
| migrations/002_create_all.sql | metrics_default | 11_observability/001_create_metrics_default.sql | yes |
| migrations/002_create_all.sql | idx_metrics_name_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_metrics_tags_gin | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | logs | 11_observability/001_create_logs.sql | yes |
| migrations/002_create_all.sql | logs_default | 11_observability/001_create_logs_default.sql | yes |
| migrations/002_create_all.sql | idx_logs_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_logs_level | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_logs_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | profiles | 11_observability/001_create_profiles.sql | yes |
| migrations/002_create_all.sql | profiles_default | 11_observability/001_create_profiles_default.sql | yes |
| migrations/002_create_all.sql | idx_profiles_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_profiles_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | cron_checkins | 11_observability/001_create_cron_checkins.sql | yes |
| migrations/002_create_all.sql | cron_checkins_default | 11_observability/001_create_cron_checkins_default.sql | yes |
| migrations/002_create_all.sql | idx_cron_monitor_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | replays | 11_observability/001_create_replays.sql | yes |
| migrations/002_create_all.sql | replays_default | 11_observability/001_create_replays_default.sql | yes |
| migrations/002_create_all.sql | idx_replays_session | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | messages | 11_observability/001_create_messages.sql | yes |
| migrations/002_create_all.sql | messages_default | 11_observability/001_create_messages_default.sql | yes |
| migrations/002_create_all.sql | idx_messages_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | sdk_sessions | 11_observability/001_create_sdk_sessions.sql | yes |
| migrations/002_create_all.sql | sdk_sessions_default | 11_observability/001_create_sdk_sessions_default.sql | yes |
| migrations/002_create_all.sql | idx_sdk_sessions_unique | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | ingestion_failures | 11_observability/001_create_ingestion_failures.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_failures_project | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_ingestion_failures_reason | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | errors | 11_observability/001_create_errors.sql | yes |
| migrations/002_create_all.sql | errors_default | 11_observability/001_create_errors_default.sql | yes |
| migrations/002_create_all.sql | idx_errors_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_fingerprint | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_unresolved | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_errors_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | requests | 11_observability/001_create_requests.sql | yes |
| migrations/002_create_all.sql | requests_default | 11_observability/001_create_requests_default.sql | yes |
| migrations/002_create_all.sql | idx_requests_project_time | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_status | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_latency | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_route | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_requests_trace | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | error_groups | 11_observability/001_create_error_groups.sql | yes |
| migrations/002_create_all.sql | idx_error_groups_active | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_errors_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_requests_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_spans_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_metrics_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_messages_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_traces_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_logs_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_profiles_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_cron_checkins_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_events_replays_project_event | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | alert_rules | 09_alerting/001_create_alert_rules.sql | yes |
| migrations/002_create_all.sql | idx_alert_rules_org_project | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_alert_rules_eval_due | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | uq_alert_rules_preset_scope | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | alert_events | 09_alerting/001_create_alert_events.sql | yes |
| migrations/002_create_all.sql | idx_alert_events_org_project_status | 09_alerting/900_indexes.sql | yes |
| migrations/002_create_all.sql | feature_flags | 11_observability/001_create_feature_flags.sql | yes |
| migrations/002_create_all.sql | uq_feature_flags_key_scope | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | idx_feature_flags_scope | 11_observability/900_indexes.sql | yes |
| migrations/002_create_all.sql | trg_feature_flags_updated_at | 11_observability/999_triggers.sql | yes |
| migrations/002_create_all.sql | usage_daily_counters_default | 07_billing/001_create_usage_daily_counters_default.sql | yes |
| migrations/002_create_all.sql | user_preferences | 04_user/001_create_user_preferences.sql | yes |
| migrations/002_create_all.sql | trg_user_preferences_updated_at | 04_user/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | type | type | yes |
| migrations/003_project_module_refactor.sql | projects | 06_project/001_create_projects.sql | yes |
| migrations/003_project_module_refactor.sql | projects | 06_project/001_create_projects.sql | yes |
| migrations/003_project_module_refactor.sql | idx_projects_org_slug_active | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_projects_org_active | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | project_environments | 06_project/001_create_project_environments.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_environments_project | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_environments_default | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_environments_active | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_environments_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_api_keys | 06_project/001_create_project_api_keys.sql | yes |
| migrations/003_project_module_refactor.sql | project_api_keys | 06_project/001_create_project_api_keys.sql | yes |
| migrations/003_project_module_refactor.sql | project_api_keys | 06_project/001_create_project_api_keys.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_keys_env | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_keys_public_key | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_keys_active_env | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_keys_rotation | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_api_keys_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_members | 06_project/001_create_project_members.sql | yes |
| migrations/003_project_module_refactor.sql | project_members | 06_project/001_create_project_members.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_members_active | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_members_project_status | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | uq_project_members_single_active_owner | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_members_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_member_invitations | 06_project/001_create_project_member_invitations.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_invitations_project | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_invitations_token | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_invitations_user | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_member_invitations_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_roles | 06_project/001_create_project_roles.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_roles_org | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_roles_project | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_roles_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_members | 06_project/001_create_project_members.sql | yes |
| migrations/003_project_module_refactor.sql | project_connector_subscriptions | 08_connector/001_create_project_connector_subscriptions.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_connector_subs_project | 08_connector/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_connector_subs_connector | 08_connector/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_connector_subs_enabled | 08_connector/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_connector_subs_updated_at | 08_connector/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | connector_configs | 08_connector/001_create_connector_configs.sql | yes |
| migrations/003_project_module_refactor.sql | project_notification_preferences | 06_project/001_create_project_notification_preferences.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_notif_prefs_project | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_notif_prefs_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_member_notification_preferences | 06_project/001_create_project_member_notification_preferences.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_member_notif_prefs_user | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_member_notif_prefs_updated_at | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | project_usage_minute | 06_project/001_create_project_usage_minute.sql | yes |
| migrations/003_project_module_refactor.sql | project_usage_hourly | 06_project/001_create_project_usage_hourly.sql | yes |
| migrations/003_project_module_refactor.sql | project_usage_daily | 06_project/001_create_project_usage_daily.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_minute_project_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_minute_org_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_hourly_project_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_hourly_org_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_daily_project_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_daily_org_bucket | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | project_usage_monthly | 06_project/001_create_project_usage_monthly.sql | yes |
| migrations/003_project_module_refactor.sql | idx_project_usage_monthly_org | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | api_key_usage_minute | 06_project/001_create_api_key_usage_minute.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_key_usage_minute_project | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | idx_api_key_usage_minute_env | 06_project/900_indexes.sql | yes |
| migrations/003_project_module_refactor.sql | bump_project_version | function | yes |
| migrations/003_project_module_refactor.sql | trg_projects_version | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_api_keys_version | 06_project/999_triggers.sql | yes |
| migrations/003_project_module_refactor.sql | trg_project_members_version | 06_project/999_triggers.sql | yes |
| migrations/004_enterprise_database_integrity.sql | idx_connector_configs_org_name_active | 08_connector/900_indexes.sql | yes |
| migrations/004_enterprise_database_integrity.sql | idx_org_members_user_status | 05_organization/900_indexes.sql | yes |
| migrations/004_enterprise_database_integrity.sql | idx_alert_rules_org_project_active | 09_alerting/900_indexes.sql | yes |
| migrations/004_enterprise_database_integrity.sql | idx_org_usage_current_period | 07_billing/900_indexes.sql | yes |

## Canonical Folder Coverage

| Canonical Folder | SQL Files Read | Objects Extracted | Objects Normalized |
| --- | ---: | ---: | ---: |
| canonical_migrations_draft | 2 | 0 | 0 |
| canonical_migrations_draft/00_shared | 3 | 2 | 2 |
| canonical_migrations_draft/01_auth | 12 | 68 | 68 |
| canonical_migrations_draft/02_organizations | 10 | 54 | 54 |
| canonical_migrations_draft/03_org_identity | 11 | 45 | 45 |
| canonical_migrations_draft/04_projects | 29 | 183 | 183 |
| canonical_migrations_draft/06_connectors | 16 | 42 | 42 |
| canonical_migrations_draft/07_notifications | 3 | 9 | 9 |
| canonical_migrations_draft/08_alerting | 28 | 53 | 53 |
| canonical_migrations_draft/09_audit | 2 | 14 | 14 |
| canonical_migrations_draft/10_security | 1 | 4 | 4 |
| canonical_migrations_draft/11_billing | 31 | 229 | 229 |
| canonical_migrations_draft/11_billing/seeder | 35 | 0 | 0 |
| canonical_migrations_draft/12_monitoring | 1 | 0 | 0 |
| canonical_migrations_draft/13_ingestion | 8 | 5 | 5 |
| canonical_migrations_draft/14_observability | 20 | 0 | 0 |
| canonical_migrations_draft/15_analytics | 8 | 9 | 9 |
| canonical_migrations_draft/16_legacy_compat | 3 | 0 | 0 |
| canonical_migrations_draft/17_enterprise_ingestion | 5 | 9 | 9 |
| canonical_migrations_draft/18_ai | 14 | 22 | 22 |
| canonical_migrations_draft/18_alerting_workspace | 10 | 66 | 66 |
| canonical_migrations_draft/19_automation | 15 | 67 | 67 |

## Remaining Unknowns

- Runtime usage is marked `unverified` where no exact table-token reference was detected in TypeScript. This does not remove canonical objects.
- Database execution validation requires a running PostgreSQL server; local `psql` was not available during generation.
- `ALTER TABLE` statements are intentionally not copied into table files for final-known column changes. Remaining ALTER statements only appear in non-table support files when emitted from source SQL and should be reviewed before production use.
