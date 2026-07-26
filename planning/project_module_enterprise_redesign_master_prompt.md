# Master Prompt: Enterprise Project Module Redesign

You are an expert backend architect and senior implementation agent. Your task is to redesign, migrate, and fully wire the Project Module for a multi-tenant SaaS observability platform. Treat this as an enterprise-grade backend refactor, not a small patch.

The repository is a TypeScript/Fastify/PostgreSQL backend. The project module currently has partial refactor work, old Project Indie schema remnants, and some tables split across non-canonical migrations. You must analyze the actual codebase before editing, then produce a complete, coherent project module implementation.

## Primary Objective

Redesign the full Project Module so that:

1. Projects are first-class tenant-scoped application containers.
2. Project creation provisions all required dependent records.
3. All new and refactored tables live in `src/db/postgres/canonical_migrations_draft` only.
4. If a table already exists in a different migration path, recreate or move its canonical definition into `canonical_migrations_draft`.
5. Runtime code uses the canonical schema only.
6. Old Project Indie schema references are removed or replaced.
7. Project alert thresholds are project-specific, not organization-specific.
8. Project alert channels are configurable per project and per member.
9. Usage data supports graphs, heatmaps, dashboards, comparisons, and API-key usage views.
10. API keys use a platform-owned prefix that users cannot edit or spoof.

## Non-Negotiable Rules

Do not assume existing code is correct.

Read the current project module, migrations, tests, alerting module, ingestion module, connector module, AI module, and organization threshold code before implementation.

Do not create tables outside `src/db/postgres/canonical_migrations_draft`.

Do not leave duplicate table definitions across migration profiles unless the duplicate is clearly marked legacy compatibility and not part of the active canonical schema.

Do not keep old Project Indie table names or columns in runtime code after the refactor.

Do not use organization-level alert thresholds for project alert evaluation, except as an optional fallback if explicitly implemented and tested.

Do not let users provide, edit, or override platform API key prefixes.

Do not return raw API key secrets after creation or rotation.

Do not route project alerts to organization members who are not project members.

Do not route project alerts only by organization membership.

Do not implement project alert channels as comments or documentation only. They must be backed by schema, repository, service, route, and delivery integration.

Do not hand-wave tests. Add focused unit and integration tests for the new schema and main flows.

## Required First Step: Codebase Audit

Before writing code, inspect:

- `src/modules/projects`
- `src/modules/alerting`
- `src/modules/connectors`
- `src/modules/ingestion`
- `src/modules/ai`
- `src/modules/organization/alert-thresholds`
- `src/db/postgres/migrations`
- `src/db/postgres/canonical_migrations_draft`
- existing tests under `test/unit` and `test/integration`

Create a short internal inventory of:

- current project tables
- old Project Indie columns still referenced
- refactor tables that exist but are not wired
- code paths using `projects.default_environment`
- code paths using `project_api_keys.environment`
- code paths using `project_api_keys.key_hash` or `key_prefix`
- code paths using `project_api_keys.org_id`
- code paths using `organization_alert_thresholds`
- code paths using old `project_usage_hourly.bucket_hour`
- code paths using old `project_usage_daily.bucket_date`
- code paths using missing `project_api_key_usage`
- code paths using notification route columns that do not exist

Fix all mismatches you find.

## Canonical Migration Requirement

Create or update canonical migration files only under:

`src/db/postgres/canonical_migrations_draft`

Recommended canonical folder layout:

- `04_projects`
- `05_project_credentials`
- `06_connectors`
- `07_notifications`
- `08_alerting`
- `13_ingestion`
- `15_analytics`
- or a new `20_project_module_refactor` folder if the repository convention supports it

If the project module schema is being redesigned, prefer a clean sequence in canonical migrations:

1. shared project enums
2. projects core
3. project settings
4. project environments
5. project members
6. project roles
7. project invitations
8. project API keys
9. API key usage
10. project usage rollups
11. project dashboard aggregates
12. project alert thresholds
13. project alert channels
14. project alert routing subscriptions
15. project notification preferences
16. project activity
17. project audit logs
18. indexes, constraints, triggers, and seed defaults

Every table must have:

- primary key
- tenant isolation columns
- foreign keys
- created_at
- updated_at when mutable
- deleted_at when soft-delete applies
- useful indexes
- uniqueness constraints scoped by project or organization
- comments where helpful

## Required Schema: Projects

The `projects` table must be lightweight.

It should contain:

- `id`
- `org_id`
- `name`
- `slug`
- `description`
- `status`
- `visibility`
- `timezone`
- `tags`
- `icon`
- `color`
- `metadata`
- `created_by`
- `updated_by`
- `archived_at`
- `deleted_at`
- `deleted_by`
- `created_at`
- `updated_at`
- `version`

It must not contain:

- `default_environment`
- SDK config blobs
- alert threshold columns
- connector IDs
- API key prefix fields
- usage counters that belong in rollup tables

Project status enum must match code and product requirements. Recommended values:

- `active`
- `paused`
- `archived`
- `suspended`

If existing code uses `paused`, the enum must support `paused`.

Project visibility enum:

- `private`
- `organization`
- `public`

Indexes:

- unique active slug per organization
- organization active project lookup
- status lookup
- cursor pagination index
- archived lookup

## Project Creation Must Provision Dependent Records

When a project is created, the service must provision:

1. `projects` row
2. owner row in `project_members`
3. default `project_settings`
4. default `project_environments`
5. default `project_usage_current` or equivalent dashboard seed row if needed
6. default `project_alert_thresholds`
7. default `project_notification_preferences`
8. default project alert channel preference rows where appropriate
9. project activity record
10. project audit record

The project creation operation must be transactional.

If any provisioning step fails, the whole project creation must roll back.

## Required Schema: Project Settings

`project_settings` should hold per-project operational configuration.

Include:

- `id`
- `project_id`
- `organization_id`
- `data_retention_days`
- `sampling_rate`
- `allowed_domains`
- `blocked_domains`
- `pii_scrubbing_enabled`
- `ip_collection_enabled`
- `release_tracking_enabled`
- `session_replay_enabled`
- `performance_monitoring_enabled`
- `error_monitoring_enabled`
- `log_ingestion_enabled`
- `metric_ingestion_enabled`
- `trace_ingestion_enabled`
- `profile_ingestion_enabled`
- `created_at`
- `updated_at`
- `version`

Project settings must be created automatically at project creation.

## Required Schema: Project Environments

Use first-class environments.

`project_environments` must include:

- `id`
- `project_id`
- `organization_id`
- `name`
- `slug`
- `description`
- `is_default`
- `is_active`
- `color`
- `icon`
- `created_by_user_id`
- `created_by_api_key_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Default environments:

- `production`
- optionally `staging`
- optionally `development`

If product behavior requires only one default, mark `production` as `is_default = true`.

Add constraints:

- unique `(project_id, slug)` where not deleted
- unique one default environment per project
- environment slug must be generated by server-side code

## Required Schema: Project API Keys

The platform owns API-key prefixes. Users cannot provide or edit prefixes.

API key design must include:

- public prefix for lookup
- secret hash for verification
- no raw secret persistence
- environment scoping
- status lifecycle
- rotation lifecycle
- rate limits
- allowed event types
- allowed SDKs
- allowed origins
- allowed IPs
- allowed domains
- sampling rules
- feature flags
- SDK config

Recommended table: `project_api_keys`

Columns:

- `id`
- `project_id`
- `organization_id`
- `environment_id`
- `public_key`
- `secret_hash`
- `key_type`
- `name`
- `description`
- `is_active`
- `status`
- `created_by`
- `rotated_from_key_id`
- `rotated_at`
- `rotated_by`
- `rotation_reason`
- `rotation_state`
- `rotation_version`
- `grace_period_ends_at`
- `revoked_at`
- `revoked_by`
- `revoked_reason`
- `expires_at`
- `auto_rotate_enabled`
- `auto_rotate_days`
- `last_used_at`
- `last_used_ip`
- `usage_count`
- `error_count`
- `rate_limit_per_second`
- `rate_limit_per_minute`
- `rate_limit_per_hour`
- `permissions`
- `allowed_endpoints`
- `blocked_endpoints`
- `allowed_sdks`
- `allowed_origins`
- `allowed_ips`
- `allowed_domains`
- `allowed_event_types`
- `sampling_rules`
- `feature_flags`
- `sdk_config`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Do not use `org_id` in `project_api_keys` unless the canonical schema also uses `org_id`. Prefer `organization_id` for consistency with other project tables.

Do not keep `environment` enum column. Use `environment_id`.

Do not keep `key_hash` or `key_prefix` in runtime code. Use `secret_hash` and `public_key`.

API key status enum must include all states used by code:

- `active`
- `suspended`
- `revoked`
- `expired`
- `rotated`

API key rotation enum:

- `none`
- `rotating`
- `grace_period`
- `completed`

API key type enum:

- `read_write`
- `read_only`
- `write_only`
- `temporary`

API key format:

- generated only by server
- prefix includes platform identifier
- prefix includes environment slug or project-safe signal if needed
- secret component must have high entropy
- store only hash
- show raw full key exactly once

Example key format:

`plv_live_<public>_<secret>`

or:

`pulsiv_prod_<public>_<secret>`

The exact prefix can differ, but must be centrally generated and not user-controlled.

## Required Schema: API Key Usage

Replace old or missing `project_api_key_usage` with canonical tables.

Recommended:

- `api_key_usage_minute`
- `api_key_usage_hourly`
- `api_key_usage_daily`

At minimum implement `api_key_usage_minute` and roll up to daily or query aggregate from minute/hourly.

Columns:

- `api_key_id`
- `project_id`
- `organization_id`
- `environment_id`
- `bucket`
- `event_type`
- `requests`
- `events`
- `errors`
- `bytes_ingested`
- `rate_limited`
- `latency_ms_p50`
- `latency_ms_p95`
- `latency_ms_p99`
- `created_at`
- `updated_at`

Indexes:

- by api key and bucket
- by project and bucket
- by environment and bucket
- by organization and bucket

Update API key usage endpoints to read from this canonical schema.

## Required Schema: Project Usage For Graphs And Heatmaps

Usage tables must support:

- dashboard summary
- time-series graph
- hourly heatmap
- day-of-week heatmap
- calendar heatmap
- environment comparison
- API key comparison
- top endpoints
- top services
- top error groups
- top SDK versions
- top releases
- alert count
- connector delivery count
- failed notification count
- latency percentiles

Recommended tables:

- `project_usage_minute`
- `project_usage_hourly`
- `project_usage_daily`
- `project_usage_monthly`

Use consistent column names:

- `bucket`, not `bucket_hour` or `bucket_date`
- `total_events`, not `event_count`

`project_usage_minute` columns:

- `organization_id`
- `project_id`
- `environment_id`
- `api_key_id`
- `bucket`
- `total_events`
- `errors`
- `requests`
- `transactions`
- `traces`
- `spans`
- `logs`
- `metrics`
- `profiles`
- `ai_events`
- `sdk_requests`
- `active_api_keys`
- `active_environments`
- `active_users`
- `active_members`
- `alert_count`
- `connector_deliveries`
- `failed_notifications`
- `top_endpoints`
- `top_services`
- `top_error_groups`
- `top_sdk_versions`
- `top_countries`
- `top_browsers`
- `top_os`
- `top_devices`
- `top_releases`
- `rate_limit_usage`
- `latency_ms_p50`
- `latency_ms_p95`
- `latency_ms_p99`
- `created_at`
- `updated_at`

`project_usage_hourly` should mirror minute schema but bucket by hour.

`project_usage_daily` should mirror hourly schema but bucket by day.

`project_usage_monthly` should support billing and plan comparisons:

- `organization_id`
- `project_id`
- `year_month`
- `total_events`
- `total_bytes`
- `api_key_requests`
- `rate_limited_events`
- `alert_notifications`
- `active_users`
- `created_at`
- `updated_at`

Project creation may seed current-period/project-current rows if the dashboard requires no-empty-state query paths.

Do not keep runtime writes to old `bucket_hour`, `bucket_date`, `event_count`, or `event_bytes` columns unless writing to explicitly named legacy tables.

## Required Schema: Project Members

`project_members` must support project RBAC independent from organization membership.

Columns:

- `id`
- `project_id`
- `organization_id`
- `user_id`
- `role`
- `role_id`
- `status`
- `added_by_user_id`
- `added_at`
- `removed_by_user_id`
- `removed_at`
- `created_at`
- `updated_at`
- `version`

Roles:

- `owner`
- `admin`
- `developer`
- `qa`
- `viewer`

Statuses:

- `pending`
- `active`
- `inactive`
- `removed`

A user can receive project alerts only if they are an active project member.

## Required Schema: Project Invitations

`project_member_invitations` must include:

- `id`
- `project_id`
- `organization_id`
- `email`
- `invited_by_user_id`
- `invited_user_id`
- `role`
- `status`
- `token_hash`
- `expires_at`
- `accepted_at`
- `declined_at`
- `cancelled_at`
- `created_at`
- `updated_at`

Do not store raw invitation tokens.

## Required Schema: Project Roles

`project_roles` must include:

- `id`
- `project_id`
- `organization_id`
- `name`
- `slug`
- `description`
- `is_system`
- `is_default`
- `permissions`
- `created_at`
- `updated_at`

Seed system roles for each organization:

- owner
- admin
- developer
- qa
- viewer

Project-specific custom roles must be supported if the product exposes them.

## Required Schema: Project Alert Thresholds

Project alert thresholds must be project-specific.

Create canonical `project_alert_thresholds`.

Do not use `organization_alert_thresholds` as the primary project threshold table.

Columns:

- `id`
- `organization_id`
- `project_id`
- `environment_id`
- `threshold_key`
- `metric_name`
- `metric_source`
- `category`
- `severity`
- `comparison_operator`
- `threshold_value`
- `threshold_unit`
- `evaluation_window_minutes`
- `cooldown_minutes`
- `consecutive_breaches`
- `enabled`
- `notify_on_recovery`
- `last_triggered_at`
- `last_recovered_at`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Also support common built-in thresholds:

- p50 latency
- p75 latency
- p90 latency
- p95 latency
- p99 latency
- error rate
- Apdex
- event volume spike
- event volume drop
- failed notification rate
- ingestion error rate
- rate limit usage
- AI usage/cost threshold if relevant

Seed default thresholds when a project is created.

Project threshold APIs:

- `GET /organizations/:orgId/projects/:projectId/alert-thresholds`
- `GET /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `POST /organizations/:orgId/projects/:projectId/alert-thresholds`
- `PATCH /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `DELETE /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `POST /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId/toggle`

Threshold evaluation must:

1. Resolve project from event/API key.
2. Load enabled project thresholds.
3. Filter by environment if environment-specific.
4. Evaluate using project usage/metric data.
5. Respect cooldown and evaluation window.
6. Emit alert event with project_id.
7. Route through project alert channels.

## Required Schema: Project Alert Channels

Projects must configure where members receive alerts.

Create canonical `project_alert_channels`.

This table configures project-level delivery destinations.

Columns:

- `id`
- `organization_id`
- `project_id`
- `connector_id`
- `channel_type`
- `name`
- `description`
- `destination`
- `destination_metadata`
- `is_default`
- `enabled`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Examples:

- Slack connector plus Slack channel ID
- Slack connector plus Slack user ID
- Teams connector plus channel ID
- Email address
- Webhook URL via connector reference
- PagerDuty service
- SMS route if supported

Do not store raw secret URLs if connector secrets infrastructure exists. Prefer connector references and encrypted connector config.

Create `project_member_alert_channel_preferences`.

Columns:

- `id`
- `organization_id`
- `project_id`
- `user_id`
- `project_alert_channel_id`
- `category`
- `severity_threshold`
- `enabled`
- `digest_mode`
- `quiet_hours`
- `created_at`
- `updated_at`
- `version`

This answers:

- which member receives which alert
- on which channel
- for which category
- at what severity
- with what quiet hours/digest behavior

## Required Schema: Project Notification Preferences

Keep or redesign `project_notification_preferences` as project defaults.

It should not replace member channel preferences.

Project defaults should include:

- category
- enabled
- severity threshold
- default channel IDs
- default member IDs or role targets
- quiet hours
- digest mode
- escalation policy

Member overrides should be explicit and queryable.

## Required Schema: Project Connector Subscriptions

Projects subscribe to organization-owned connectors.

`project_connector_subscriptions` should include:

- `id`
- `project_id`
- `organization_id`
- `connector_id`
- `enabled`
- `alert_categories`
- `severity_threshold`
- `member_ids`
- `channel_overrides`
- `quiet_hours`
- `digest_mode`
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Connector configs remain organization-owned.

Do not duplicate connector credentials per project.

Do not use `connector_configs.project_id` for active routing. If old data exists, migrate it into `project_connector_subscriptions` and remove runtime dependency on `connector_configs.project_id`.

## Required Schema: Project Activity And Audit

Implement project activity feed and project audit logs.

Recommended:

- `project_activity`
- `project_audit_logs`

`project_activity` supports dashboard timelines.

`project_audit_logs` supports compliance and immutable change history.

If the product already writes project events to `organization_audit_logs`, choose one model:

- either write project audit into dedicated `project_audit_logs`
- or clearly keep organization audit as source and expose project activity from it

Do not create unused audit tables. If you create `project_audit_logs`, write to it.

## Required Runtime Refactor

Update repositories, services, and routes so runtime code uses canonical schema only.

Replace:

- `projects.default_environment` with `project_environments`
- `project_api_keys.environment` with `project_api_keys.environment_id`
- `project_api_keys.key_hash` with `project_api_keys.secret_hash`
- `project_api_keys.key_prefix` with `project_api_keys.public_key`
- `project_api_keys.org_id` with `project_api_keys.organization_id` unless schema says otherwise
- `project_api_key_usage` with canonical API-key usage tables
- old usage `bucket_hour/bucket_date` with `bucket`
- organization alert thresholds with project alert thresholds

Make all query columns match canonical migrations.

## Project API Requirements

Expose or fix routes for:

- project CRUD
- archive/unarchive
- pause/resume
- restore
- project settings
- project environments
- project API keys
- API key rotation
- API key usage
- project members
- project invitations
- project roles
- project usage analytics
- project alert thresholds
- project alert channels
- project notification preferences
- project connector subscriptions
- project activity
- project audit logs

All project routes must be under:

`/organizations/:orgId/projects`

All routes must:

- authenticate
- validate params/query/body with Zod
- enforce project membership
- enforce project role
- use tenant scoping
- return standard response envelopes
- map expected errors to stable error codes

## Project Analytics Requirements

Implement analytics endpoints:

- `GET /organizations/:orgId/projects/:projectId/analytics/usage`
- `GET /organizations/:orgId/projects/:projectId/analytics/heatmap`
- `GET /organizations/:orgId/projects/:projectId/analytics/top`
- `GET /organizations/:orgId/projects/:projectId/analytics/comparison`
- `GET /organizations/:orgId/projects/:projectId/analytics/monthly-usage`

Support filters:

- `from`
- `to`
- `granularity`
- `environmentId`
- `apiKeyId`
- `category`
- `limit`
- `cursor`

Usage graph output must include:

- bucket timestamp
- total events
- requests
- errors
- traces
- logs
- metrics
- profiles
- latency p50/p95/p99

Heatmap output must support:

- calendar heatmap
- hour-of-day heatmap
- day-of-week heatmap

Top-list output must support:

- endpoints
- services
- error groups
- SDK versions
- releases
- countries
- browsers
- OS
- devices

Comparison output must support:

- environments
- API keys

## Ingestion Integration

Update ingestion API-key validation to:

1. Extract server-owned public prefix.
2. Lookup candidate rows by `public_key`.
3. Constant-time compare raw key hash against `secret_hash`.
4. Verify project is active.
5. Verify environment is active.
6. Verify key status and expiry.
7. Enforce allowed event types.
8. Enforce allowed origins/IPs/domains if request context supports it.
9. Enforce rate limits.
10. Return project ID, organization ID, environment ID, and API key ID.

Update ingestion usage writes to canonical rollup/staging tables.

Do not write to old usage tables.

## Alerting Integration

Update alerting to:

1. Resolve project-specific thresholds.
2. Evaluate thresholds using canonical usage/metric tables.
3. Emit alert events with `project_id`.
4. Resolve project connector subscriptions.
5. Resolve project alert channels.
6. Resolve project member channel preferences.
7. Drop delivery to non-project members.
8. Respect quiet hours.
9. Respect severity threshold.
10. Respect digest mode if implemented.
11. Queue connector deliveries.
12. Record delivery attempts.

Project alert delivery must not be connector-only. It must know which project channels and members are selected.

## Migration Safety

If old production data may exist:

- write backfills
- do not drop data before migrating
- rename legacy tables if necessary
- preserve raw key secrecy
- for unbackfillable legacy keys, mark them for rotation and document behavior

Backfill examples:

- create environments from old API key environment enum
- create project settings for every project
- create default alert thresholds for every project
- create notification preferences for every project
- migrate connector_configs.project_id to project_connector_subscriptions
- migrate old usage tables to canonical usage tables if data is compatible

Do not set NOT NULL constraints before backfilling required values.

## Testing Requirements

Add or update tests for:

- canonical migrations compile and apply
- project creation provisions dependent records
- project API key creation uses platform prefix
- user cannot provide API key prefix
- raw API key is returned once
- API key validation resolves project/environment
- API key rotation supports grace window
- old API key is rejected after no-grace rotation
- project usage endpoint reads canonical usage tables
- heatmap endpoint reads canonical usage tables
- API key usage endpoint reads canonical API-key usage tables
- project alert threshold CRUD
- threshold evaluation uses project threshold
- organization threshold does not override project threshold
- project alert channel CRUD
- member channel preference CRUD
- alert delivery drops non-project members
- alert delivery uses project channel preferences
- connector subscription gates project delivery
- AI accessible projects no longer uses `default_environment`

Run:

- `npm run build`
- focused unit tests
- focused integration tests
- migration tests

If a command fails, fix real issues rather than hiding them.

## Acceptance Criteria

The task is complete only when:

1. Canonical migrations contain the full project module schema.
2. Runtime code compiles against canonical schema.
3. Project creation provisions all required project records.
4. API keys use server-owned prefixes only.
5. API key runtime no longer references old columns.
6. Usage runtime no longer references old usage columns.
7. AI project lookup no longer references `default_environment`.
8. Project alert thresholds exist and are used.
9. Project alert channels exist and are used.
10. Alert delivery is project-scoped and member-aware.
11. Tests cover the critical flows.
12. The final report lists all changed files, migrations, and verification commands.

## Final Report Format

When finished, report:

- what schema was created or changed
- what runtime modules were updated
- which old schema references were removed
- how project creation provisions dependencies
- how API keys are generated and verified
- how usage graphs and heatmaps are backed
- how project alert thresholds work
- how project alert channels work
- what tests were added
- verification results
- remaining risks or follow-up work

## Implementation Guidance

Prefer small cohesive modules:

- `projects/core`
- `projects/settings`
- `projects/environments`
- `projects/api-keys`
- `projects/members`
- `projects/usage`
- `projects/alerts/thresholds`
- `projects/alerts/channels`
- `projects/alerts/preferences`
- `projects/alerts/subscriptions`
- `projects/activity`
- `projects/audit`

Keep repositories responsible for SQL.

Keep services responsible for authorization and business rules.

Keep routes responsible for authentication, validation, request metadata, and response envelopes.

Keep migration names explicit.

Keep SQL parameterized.

Keep tenant isolation visible in every query.

Keep project membership checks central.

Do not introduce unrelated refactors.

Do not modify generated `dist` files unless the repository explicitly tracks build output and the task requires it.

## Known Issues To Check From Previous Audit

Check and fix these exact risks:

- `project_api_keys.org_id` used in code while canonical schema has `organization_id`
- code writes `api_key_status = suspended`
- code writes `api_key_status = rotated`
- project status code uses `paused` while schema may not
- AI repository selects `projects.default_environment`
- usage repository writes `project_usage_hourly.bucket_hour`
- usage repository writes `project_usage_daily.bucket_date`
- API key usage reads `project_api_key_usage`
- project alert route repository assumes `notification_routes.project_id`
- project alert route repository assumes `notification_routes.throttle`
- organization alert thresholds are used instead of project thresholds
- member notification preferences are not connected to delivery
- connector subscriptions gate connectors but do not materialize member/channel recipients
- `project_audit_logs` may exist but not be written
- `project_activity` may exist but not be consistently written

Fix them completely.

## Product Outcome

After this redesign, the product must be able to:

- create a project and immediately show a dashboard
- create environments
- create API keys with platform-owned prefixes
- ingest events scoped to project and environment
- show usage graphs
- show heatmaps
- show API-key usage
- configure project-specific alert thresholds
- configure project-level alert channels
- configure member-specific alert delivery
- route Slack/Email/Webhook/Teams/PagerDuty alerts only to intended project recipients
- audit project lifecycle and sensitive changes

This is the expected enterprise-grade end state.
# Master Prompt: Enterprise Project Module Redesign

You are an expert backend architect and senior implementation agent. Your task is to redesign, migrate, and fully wire the Project Module for a multi-tenant SaaS observability platform. Treat this as an enterprise-grade backend refactor, not a small patch.

The repository is a TypeScript/Fastify/PostgreSQL backend. The project module currently has partial refactor work, old Project Indie schema remnants, and some tables split across non-canonical migrations. You must analyze the actual codebase before editing, then produce a complete, coherent project module implementation.

## Primary Objective

Redesign the full Project Module so that:

1. Projects are first-class tenant-scoped application containers.
2. Project creation provisions all required dependent records.
3. All new and refactored tables live in `src/db/postgres/canonical_migrations_draft` only.
4. If a table already exists in a different migration path, recreate or move its canonical definition into `canonical_migrations_draft`.
5. Runtime code uses the canonical schema only.
6. Old Project Indie schema references are removed or replaced.
7. Project alert thresholds are project-specific, not organization-specific.
8. Project alert channels are configurable per project and per member.
9. Usage data supports graphs, heatmaps, dashboards, comparisons, and API-key usage views.
10. API keys use a platform-owned prefix that users cannot edit or spoof.

## Non-Negotiable Rules

Do not assume existing code is correct.

Read the current project module, migrations, tests, alerting module, ingestion module, connector module, AI module, and organization threshold code before implementation.

Do not create tables outside `src/db/postgres/canonical_migrations_draft`.

Do not leave duplicate table definitions across migration profiles unless the duplicate is clearly marked legacy compatibility and not part of the active canonical schema.

Do not keep old Project Indie table names or columns in runtime code after the refactor.

Do not use organization-level alert thresholds for project alert evaluation, except as an optional fallback if explicitly implemented and tested.

Do not let users provide, edit, or override platform API key prefixes.

Do not return raw API key secrets after creation or rotation.

Do not route project alerts to organization members who are not project members.

Do not route project alerts only by organization membership.

Do not implement project alert channels as comments or documentation only. They must be backed by schema, repository, service, route, and delivery integration.

Do not hand-wave tests. Add focused unit and integration tests for the new schema and main flows.

## Required First Step: Codebase Audit

Before writing code, inspect:

- `src/modules/projects`
- `src/modules/alerting`
- `src/modules/connectors`
- `src/modules/ingestion`
- `src/modules/ai`
- `src/modules/organization/alert-thresholds`
- `src/db/postgres/migrations`
- `src/db/postgres/canonical_migrations_draft`
- existing tests under `test/unit` and `test/integration`

Create a short internal inventory of:

- current project tables
- old Project Indie columns still referenced
- refactor tables that exist but are not wired
- code paths using `projects.default_environment`
- code paths using `project_api_keys.environment`
- code paths using `project_api_keys.key_hash` or `key_prefix`
- code paths using `project_api_keys.org_id`
- code paths using `organization_alert_thresholds`
- code paths using old `project_usage_hourly.bucket_hour`
- code paths using old `project_usage_daily.bucket_date`
- code paths using missing `project_api_key_usage`
- code paths using notification route columns that do not exist

Fix all mismatches you find.

## Canonical Migration Requirement

Create or update canonical migration files only under:

`src/db/postgres/canonical_migrations_draft`

Recommended canonical folder layout:

- `04_projects`
- `05_project_credentials`
- `06_connectors`
- `07_notifications`
- `08_alerting`
- `13_ingestion`
- `15_analytics`
- or a new `20_project_module_refactor` folder if the repository convention supports it

If the project module schema is being redesigned, prefer a clean sequence in canonical migrations:

1. shared project enums
2. projects core
3. project settings
4. project environments
5. project members
6. project roles
7. project invitations
8. project API keys
9. API key usage
10. project usage rollups
11. project dashboard aggregates
12. project alert thresholds
13. project alert channels
14. project alert routing subscriptions
15. project notification preferences
16. project activity
17. project audit logs
18. indexes, constraints, triggers, and seed defaults

Every table must have:

- primary key
- tenant isolation columns
- foreign keys
- created_at
- updated_at when mutable
- deleted_at when soft-delete applies
- useful indexes
- uniqueness constraints scoped by project or organization
- comments where helpful

## Required Schema: Projects

The `projects` table must be lightweight.

It should contain:

- `id`
- `org_id`
- `name`
- `slug`
- `description`
- `status`
- `visibility`
- `timezone`
- `tags`
- `icon`
- `color`
- `metadata`
- `created_by`
- `updated_by`
- `archived_at`
- `deleted_at`
- `deleted_by`
- `created_at`
- `updated_at`
- `version`

It must not contain:

- `default_environment`
- SDK config blobs
- alert threshold columns
- connector IDs
- API key prefix fields
- usage counters that belong in rollup tables

Project status enum must match code and product requirements. Recommended values:

- `active`
- `paused`
- `archived`
- `suspended`

Project visibility enum:

- `private`
- `organization`
- `public`

Indexes:

- unique active slug per organization
- organization active project lookup
- status lookup
- cursor pagination index
- archived lookup

## Project Creation Must Provision Dependent Records

When a project is created, the service must provision all required records transactionally:

1. `projects` row
2. owner row in `project_members`
3. default `project_settings`
4. default `project_environments`
5. dashboard/usage seed rows where needed
6. default `project_alert_thresholds`
7. default `project_notification_preferences`
8. default project alert channel preference rows where appropriate
9. project activity record
10. project audit record

If any provisioning step fails, the whole project creation must roll back.

## Required Schema: Project Settings

`project_settings` should hold per-project operational configuration.

Include:

- `id`
- `project_id`
- `organization_id`
- `data_retention_days`
- `sampling_rate`
- `allowed_domains`
- `blocked_domains`
- `pii_scrubbing_enabled`
- `ip_collection_enabled`
- `release_tracking_enabled`
- `session_replay_enabled`
- `performance_monitoring_enabled`
- `error_monitoring_enabled`
- `log_ingestion_enabled`
- `metric_ingestion_enabled`
- `trace_ingestion_enabled`
- `profile_ingestion_enabled`
- `created_at`
- `updated_at`
- `version`

Project settings must be created automatically at project creation.

## Required Schema: Project Environments

Use first-class environments.

`project_environments` must include:

- `id`
- `project_id`
- `organization_id`
- `name`
- `slug`
- `description`
- `is_default`
- `is_active`
- `color`
- `icon`
- `created_by_user_id`
- `created_by_api_key_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Default environments:

- `production`
- optionally `staging`
- optionally `development`

Add constraints:

- unique `(project_id, slug)` where not deleted
- unique one default environment per project
- environment slug must be generated by server-side code

## Required Schema: Project API Keys

The platform owns API-key prefixes. Users cannot provide or edit prefixes.

Recommended table: `project_api_keys`.

Columns:

- `id`
- `project_id`
- `organization_id`
- `environment_id`
- `public_key`
- `secret_hash`
- `key_type`
- `name`
- `description`
- `is_active`
- `status`
- `created_by`
- `rotated_from_key_id`
- `rotated_at`
- `rotated_by`
- `rotation_reason`
- `rotation_state`
- `rotation_version`
- `grace_period_ends_at`
- `revoked_at`
- `revoked_by`
- `revoked_reason`
- `expires_at`
- `auto_rotate_enabled`
- `auto_rotate_days`
- `last_used_at`
- `last_used_ip`
- `usage_count`
- `error_count`
- `rate_limit_per_second`
- `rate_limit_per_minute`
- `rate_limit_per_hour`
- `permissions`
- `allowed_endpoints`
- `blocked_endpoints`
- `allowed_sdks`
- `allowed_origins`
- `allowed_ips`
- `allowed_domains`
- `allowed_event_types`
- `sampling_rules`
- `feature_flags`
- `sdk_config`
- `metadata`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Do not use `org_id` in `project_api_keys` unless the canonical schema also uses `org_id`. Prefer `organization_id`.

Do not keep `environment` enum column. Use `environment_id`.

Do not keep `key_hash` or `key_prefix` in runtime code. Use `secret_hash` and `public_key`.

API key status enum must include all states used by code:

- `active`
- `suspended`
- `revoked`
- `expired`
- `rotated`

API key rotation enum:

- `none`
- `rotating`
- `grace_period`
- `completed`

API key type enum:

- `read_write`
- `read_only`
- `write_only`
- `temporary`

API key format:

- generated only by server
- prefix includes platform identifier
- prefix includes environment slug or project-safe signal if needed
- secret component must have high entropy
- store only hash
- show raw full key exactly once

Example key format:

`plv_live_<public>_<secret>`

or:

`pulsiv_prod_<public>_<secret>`

The exact prefix can differ, but it must be centrally generated and not user-controlled.

## Required Schema: API Key Usage

Replace old or missing `project_api_key_usage` with canonical tables.

Recommended:

- `api_key_usage_minute`
- `api_key_usage_hourly`
- `api_key_usage_daily`

At minimum implement `api_key_usage_minute` and roll up to daily or query aggregate from minute/hourly.

Columns:

- `api_key_id`
- `project_id`
- `organization_id`
- `environment_id`
- `bucket`
- `event_type`
- `requests`
- `events`
- `errors`
- `bytes_ingested`
- `rate_limited`
- `latency_ms_p50`
- `latency_ms_p95`
- `latency_ms_p99`
- `created_at`
- `updated_at`

Indexes:

- by API key and bucket
- by project and bucket
- by environment and bucket
- by organization and bucket

Update API-key usage endpoints to read from this canonical schema.

## Required Schema: Project Usage For Graphs And Heatmaps

Usage tables must support:

- dashboard summary
- time-series graph
- hourly heatmap
- day-of-week heatmap
- calendar heatmap
- environment comparison
- API key comparison
- top endpoints
- top services
- top error groups
- top SDK versions
- top releases
- alert count
- connector delivery count
- failed notification count
- latency percentiles

Recommended tables:

- `project_usage_minute`
- `project_usage_hourly`
- `project_usage_daily`
- `project_usage_monthly`

Use consistent column names:

- `bucket`, not `bucket_hour` or `bucket_date`
- `total_events`, not `event_count`

`project_usage_minute`, `project_usage_hourly`, and `project_usage_daily` should contain:

- `organization_id`
- `project_id`
- `environment_id`
- `api_key_id`
- `bucket`
- `total_events`
- `errors`
- `requests`
- `transactions`
- `traces`
- `spans`
- `logs`
- `metrics`
- `profiles`
- `ai_events`
- `sdk_requests`
- `active_api_keys`
- `active_environments`
- `active_users`
- `active_members`
- `alert_count`
- `connector_deliveries`
- `failed_notifications`
- `top_endpoints`
- `top_services`
- `top_error_groups`
- `top_sdk_versions`
- `top_countries`
- `top_browsers`
- `top_os`
- `top_devices`
- `top_releases`
- `rate_limit_usage`
- `latency_ms_p50`
- `latency_ms_p95`
- `latency_ms_p99`
- `created_at`
- `updated_at`

`project_usage_monthly` should support billing and plan comparisons:

- `organization_id`
- `project_id`
- `year_month`
- `total_events`
- `total_bytes`
- `api_key_requests`
- `rate_limited_events`
- `alert_notifications`
- `active_users`
- `created_at`
- `updated_at`

Project creation may seed current-period/project-current rows if the dashboard requires no-empty-state query paths.

Do not keep runtime writes to old `bucket_hour`, `bucket_date`, `event_count`, or `event_bytes` columns unless writing to explicitly named legacy tables.

## Required Schema: Project Members

`project_members` must support project RBAC independent from organization membership.

Columns:

- `id`
- `project_id`
- `organization_id`
- `user_id`
- `role`
- `role_id`
- `status`
- `added_by_user_id`
- `added_at`
- `removed_by_user_id`
- `removed_at`
- `created_at`
- `updated_at`
- `version`

Roles:

- `owner`
- `admin`
- `developer`
- `qa`
- `viewer`

Statuses:

- `pending`
- `active`
- `inactive`
- `removed`

A user can receive project alerts only if they are an active project member.

## Required Schema: Project Invitations

`project_member_invitations` must include:

- `id`
- `project_id`
- `organization_id`
- `email`
- `invited_by_user_id`
- `invited_user_id`
- `role`
- `status`
- `token_hash`
- `expires_at`
- `accepted_at`
- `declined_at`
- `cancelled_at`
- `created_at`
- `updated_at`

Do not store raw invitation tokens.

## Required Schema: Project Roles

`project_roles` must include:

- `id`
- `project_id`
- `organization_id`
- `name`
- `slug`
- `description`
- `is_system`
- `is_default`
- `permissions`
- `created_at`
- `updated_at`

Seed system roles:

- owner
- admin
- developer
- qa
- viewer

Support project-specific custom roles if the product exposes them.

## Required Schema: Project Alert Thresholds

Project alert thresholds must be project-specific.

Create canonical `project_alert_thresholds`.

Do not use `organization_alert_thresholds` as the primary project threshold table.

Columns:

- `id`
- `organization_id`
- `project_id`
- `environment_id`
- `threshold_key`
- `metric_name`
- `metric_source`
- `category`
- `severity`
- `comparison_operator`
- `threshold_value`
- `threshold_unit`
- `evaluation_window_minutes`
- `cooldown_minutes`
- `consecutive_breaches`
- `enabled`
- `notify_on_recovery`
- `last_triggered_at`
- `last_recovered_at`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Built-in thresholds:

- p50 latency
- p75 latency
- p90 latency
- p95 latency
- p99 latency
- error rate
- Apdex
- event volume spike
- event volume drop
- failed notification rate
- ingestion error rate
- rate limit usage
- AI usage/cost threshold if relevant

Seed default thresholds when a project is created.

Project threshold APIs:

- `GET /organizations/:orgId/projects/:projectId/alert-thresholds`
- `GET /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `POST /organizations/:orgId/projects/:projectId/alert-thresholds`
- `PATCH /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `DELETE /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId`
- `POST /organizations/:orgId/projects/:projectId/alert-thresholds/:thresholdId/toggle`

Threshold evaluation must:

1. Resolve project from event/API key.
2. Load enabled project thresholds.
3. Filter by environment if environment-specific.
4. Evaluate using project usage/metric data.
5. Respect cooldown and evaluation window.
6. Emit alert event with project_id.
7. Route through project alert channels.

## Required Schema: Project Alert Channels

Projects must configure where members receive alerts.

Create canonical `project_alert_channels`.

Columns:

- `id`
- `organization_id`
- `project_id`
- `connector_id`
- `channel_type`
- `name`
- `description`
- `destination`
- `destination_metadata`
- `is_default`
- `enabled`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Examples:

- Slack connector plus Slack channel ID
- Slack connector plus Slack user ID
- Teams connector plus channel ID
- Email address
- Webhook URL via connector reference
- PagerDuty service
- SMS route if supported

Do not store raw secret URLs if connector secrets infrastructure exists. Prefer connector references and encrypted connector config.

Create `project_member_alert_channel_preferences`.

Columns:

- `id`
- `organization_id`
- `project_id`
- `user_id`
- `project_alert_channel_id`
- `category`
- `severity_threshold`
- `enabled`
- `digest_mode`
- `quiet_hours`
- `created_at`
- `updated_at`
- `version`

This answers:

- which member receives which alert
- on which channel
- for which category
- at what severity
- with what quiet hours/digest behavior

## Required Schema: Project Notification Preferences

Keep or redesign `project_notification_preferences` as project defaults.

It should not replace member channel preferences.

Project defaults should include:

- category
- enabled
- severity threshold
- default channel IDs
- default member IDs or role targets
- quiet hours
- digest mode
- escalation policy

Member overrides should be explicit and queryable.

## Required Schema: Project Connector Subscriptions

Projects subscribe to organization-owned connectors.

`project_connector_subscriptions` should include:

- `id`
- `project_id`
- `organization_id`
- `connector_id`
- `enabled`
- `alert_categories`
- `severity_threshold`
- `member_ids`
- `channel_overrides`
- `quiet_hours`
- `digest_mode`
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`

Connector configs remain organization-owned.

Do not duplicate connector credentials per project.

Do not use `connector_configs.project_id` for active routing. If old data exists, migrate it into `project_connector_subscriptions` and remove runtime dependency on `connector_configs.project_id`.

## Required Schema: Project Activity And Audit

Implement project activity feed and project audit logs.

Recommended:

- `project_activity`
- `project_audit_logs`

If the product already writes project events to `organization_audit_logs`, choose one model:

- either write project audit into dedicated `project_audit_logs`
- or clearly keep organization audit as source and expose project activity from it

Do not create unused audit tables. If you create `project_audit_logs`, write to it.

## Required Runtime Refactor

Update repositories, services, and routes so runtime code uses canonical schema only.

Replace:

- `projects.default_environment` with `project_environments`
- `project_api_keys.environment` with `project_api_keys.environment_id`
- `project_api_keys.key_hash` with `project_api_keys.secret_hash`
- `project_api_keys.key_prefix` with `project_api_keys.public_key`
- `project_api_keys.org_id` with `project_api_keys.organization_id` unless schema says otherwise
- `project_api_key_usage` with canonical API-key usage tables
- old usage `bucket_hour/bucket_date` with `bucket`
- organization alert thresholds with project alert thresholds

Make all query columns match canonical migrations.

## Project API Requirements

Expose or fix routes for:

- project CRUD
- archive/unarchive
- pause/resume
- restore
- project settings
- project environments
- project API keys
- API key rotation
- API key usage
- project members
- project invitations
- project roles
- project usage analytics
- project alert thresholds
- project alert channels
- project notification preferences
- project connector subscriptions
- project activity
- project audit logs

All project routes must be under:

`/organizations/:orgId/projects`

All routes must:

- authenticate
- validate params/query/body with Zod
- enforce project membership
- enforce project role
- use tenant scoping
- return standard response envelopes
- map expected errors to stable error codes

## Project Analytics Requirements

Implement analytics endpoints:

- `GET /organizations/:orgId/projects/:projectId/analytics/usage`
- `GET /organizations/:orgId/projects/:projectId/analytics/heatmap`
- `GET /organizations/:orgId/projects/:projectId/analytics/top`
- `GET /organizations/:orgId/projects/:projectId/analytics/comparison`
- `GET /organizations/:orgId/projects/:projectId/analytics/monthly-usage`

Support filters:

- `from`
- `to`
- `granularity`
- `environmentId`
- `apiKeyId`
- `category`
- `limit`
- `cursor`

Usage graph output must include:

- bucket timestamp
- total events
- requests
- errors
- traces
- logs
- metrics
- profiles
- latency p50/p95/p99

Heatmap output must support:

- calendar heatmap
- hour-of-day heatmap
- day-of-week heatmap

Top-list output must support:

- endpoints
- services
- error groups
- SDK versions
- releases
- countries
- browsers
- OS
- devices

Comparison output must support:

- environments
- API keys

## Ingestion Integration

Update ingestion API-key validation to:

1. Extract server-owned public prefix.
2. Lookup candidate rows by `public_key`.
3. Constant-time compare raw key hash against `secret_hash`.
4. Verify project is active.
5. Verify environment is active.
6. Verify key status and expiry.
7. Enforce allowed event types.
8. Enforce allowed origins/IPs/domains if request context supports it.
9. Enforce rate limits.
10. Return project ID, organization ID, environment ID, and API key ID.

Update ingestion usage writes to canonical rollup/staging tables.

Do not write to old usage tables.

## Alerting Integration

Update alerting to:

1. Resolve project-specific thresholds.
2. Evaluate thresholds using canonical usage/metric tables.
3. Emit alert events with `project_id`.
4. Resolve project connector subscriptions.
5. Resolve project alert channels.
6. Resolve project member channel preferences.
7. Drop delivery to non-project members.
8. Respect quiet hours.
9. Respect severity threshold.
10. Respect digest mode if implemented.
11. Queue connector deliveries.
12. Record delivery attempts.

Project alert delivery must not be connector-only. It must know which project channels and members are selected.

## Migration Safety

If old production data may exist:

- write backfills
- do not drop data before migrating
- rename legacy tables if necessary
- preserve raw key secrecy
- for unbackfillable legacy keys, mark them for rotation and document behavior

Backfill examples:

- create environments from old API key environment enum
- create project settings for every project
- create default alert thresholds for every project
- create notification preferences for every project
- migrate `connector_configs.project_id` to `project_connector_subscriptions`
- migrate old usage tables to canonical usage tables if data is compatible

Do not set NOT NULL constraints before backfilling required values.

## Testing Requirements

Add or update tests for:

- canonical migrations compile and apply
- project creation provisions dependent records
- project API key creation uses platform prefix
- user cannot provide API key prefix
- raw API key is returned once
- API key validation resolves project/environment
- API key rotation supports grace window
- old API key is rejected after no-grace rotation
- project usage endpoint reads canonical usage tables
- heatmap endpoint reads canonical usage tables
- API-key usage endpoint reads canonical API-key usage tables
- project alert threshold CRUD
- threshold evaluation uses project threshold
- organization threshold does not override project threshold
- project alert channel CRUD
- member channel preference CRUD
- alert delivery drops non-project members
- alert delivery uses project channel preferences
- connector subscription gates project delivery
- AI accessible projects no longer uses `default_environment`

Run:

- `npm run build`
- focused unit tests
- focused integration tests
- migration tests

If a command fails, fix real issues rather than hiding them.

## Acceptance Criteria

The task is complete only when:

1. Canonical migrations contain the full project module schema.
2. Runtime code compiles against canonical schema.
3. Project creation provisions all required project records.
4. API keys use server-owned prefixes only.
5. API-key runtime no longer references old columns.
6. Usage runtime no longer references old usage columns.
7. AI project lookup no longer references `default_environment`.
8. Project alert thresholds exist and are used.
9. Project alert channels exist and are used.
10. Alert delivery is project-scoped and member-aware.
11. Tests cover the critical flows.
12. Final report lists all changed files, migrations, and verification commands.

## Final Report Format

When finished, report:

- what schema was created or changed
- what runtime modules were updated
- which old schema references were removed
- how project creation provisions dependencies
- how API keys are generated and verified
- how usage graphs and heatmaps are backed
- how project alert thresholds work
- how project alert channels work
- what tests were added
- verification results
- remaining risks or follow-up work

## Implementation Guidance

Prefer small cohesive modules:

- `projects/core`
- `projects/settings`
- `projects/environments`
- `projects/api-keys`
- `projects/members`
- `projects/usage`
- `projects/alerts/thresholds`
- `projects/alerts/channels`
- `projects/alerts/preferences`
- `projects/alerts/subscriptions`
- `projects/activity`
- `projects/audit`

Keep repositories responsible for SQL.

Keep services responsible for authorization and business rules.

Keep routes responsible for authentication, validation, request metadata, and response envelopes.

Keep migration names explicit.

Keep SQL parameterized.

Keep tenant isolation visible in every query.

Keep project membership checks central.

Do not introduce unrelated refactors.

Do not modify generated `dist` files unless the repository explicitly tracks build output and the task requires it.

## Known Issues To Check From Previous Audit

Check and fix these exact risks:

- `project_api_keys.org_id` used in code while canonical schema has `organization_id`
- code writes `api_key_status = suspended`
- code writes `api_key_status = rotated`
- project status code uses `paused` while schema may not
- AI repository selects `projects.default_environment`
- usage repository writes `project_usage_hourly.bucket_hour`
- usage repository writes `project_usage_daily.bucket_date`
- API-key usage reads `project_api_key_usage`
- project alert route repository assumes `notification_routes.project_id`
- project alert route repository assumes `notification_routes.throttle`
- organization alert thresholds are used instead of project thresholds
- member notification preferences are not connected to delivery
- connector subscriptions gate connectors but do not materialize member/channel recipients
- `project_audit_logs` may exist but not be written
- `project_activity` may exist but not be consistently written

Fix them completely.

## Product Outcome

After this redesign, the product must be able to:

- create a project and immediately show a dashboard
- create environments
- create API keys with platform-owned prefixes
- ingest events scoped to project and environment
- show usage graphs
- show heatmaps
- show API-key usage
- configure project-specific alert thresholds
- configure project-level alert channels
- configure member-specific alert delivery
- route Slack/Email/Webhook/Teams/PagerDuty alerts only to intended project recipients
- audit project lifecycle and sensitive changes

This is the expected enterprise-grade end state.
