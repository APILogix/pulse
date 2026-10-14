# Frontend Page Inventory for Billing Catalog Redesign

Generated from the current `pulsiv_fe` frontend route tree and navigation, then compared against the backend billing catalog in `pulse`.

## Sources Checked

- Frontend router: `pulsiv_fe/src/app/router/protected-routes.tsx`
- Frontend navigation: `pulsiv_fe/src/app/navigation/navigation.tsx`
- Frontend page directories: `pulsiv_fe/src/pages/**`, `pulsiv_fe/src/modules/**/pages/**`
- Billing frontend API wrapper: `pulsiv_fe/src/modules/organizations/api/org.api.ts`
- Backend catalog: `pulse/src/modules/billing/catalog/*`
- Backend billing docs: `pulse/docs/billing/*.json`

## Product Surface Inventory

### Home

Frontend pages:

- `/:orgSlug/dashboard`

Catalog meaning:

- This is the global product landing surface.
- It should not be separately billable unless widgets become configurable or premium.

Current catalog coverage:

- Covered indirectly by `dashboards.enabled`.

Catalog redesign note:

- Keep as included baseline. Do not create a separate `home.enabled` entitlement.

### Dashboards

Frontend pages:

- `/:orgSlug/dashboards`
- `/:orgSlug/dashboards/overview`
- `/:orgSlug/dashboards/executive`
- `/:orgSlug/dashboards/performance`
- `/:orgSlug/dashboards/errors`
- `/:orgSlug/dashboards/geo`
- `/:orgSlug/dashboards/realtime`
- `/:orgSlug/dashboards/tracing`
- `/:orgSlug/dashboards/infrastructure`
- `/:orgSlug/dashboards/security`
- `/:orgSlug/dashboards/releases`
- `/:orgSlug/dashboards/business`
- `/:orgSlug/dashboards/reports`
- `/:orgSlug/dashboards/reports/new`

Catalog meaning:

- Dashboards are not just one generic feature. The UI exposes packaged dashboards, custom report scheduling, report creation, and business/infra/security views.
- `ScheduledReportsPage` and `CreateReportPage` are currently frontend-only/static flows, but they are real routed pages.

Current catalog coverage:

- `dashboards.enabled`
- `dashboards.custom_dashboards`
- `quota.dashboards`

Missing or questionable:

- `dashboards.scheduled_reports` was removed in the current audit, but the frontend has scheduled reports pages.
- Missing `quota.scheduled_reports` or `quota.report_recipients`.
- Missing feature separation for executive/business/security/infra dashboards if those are meant to vary by tier.

Recommendation:

- Reintroduce scheduled reporting as a real catalog dimension only if backend will support it.
- If dashboards are all included, keep packaged dashboard pages as marketing/product value under `dashboards.enabled`, and gate only custom dashboards/report scheduling.

### Observability

Frontend pages:

- `/:orgSlug/observability`
- Requests list/detail
- Errors list/detail
- Error groups list/detail
- Latency
- Traces list/detail/span detail
- Logs list/detail
- Metrics list/detail
- Profiling list/detail
- Cron check-ins list/detail
- Replay
- Runtime metrics
- Event loop
- GC monitoring

Catalog meaning:

- The UI product is a full observability suite: requests, errors, traces, logs, metrics, profiling, replay, cron monitoring, runtime metrics, event loop, and GC monitoring.

Current catalog coverage:

- `error_tracking.enabled`
- `tracing.enabled`
- `logging.enabled`
- `metrics.enabled`
- `profiling.enabled`
- `replay.enabled`
- `uptime.enabled`
- `cron_monitoring.enabled`
- `quota.retention_days`
- `quota.monthly_events`

Missing or questionable:

- Runtime metrics, event loop, GC monitoring have pages but no explicit feature keys.
- Requests/APM is not clearly represented; it may be implied by tracing or monthly credits, but the UI treats requests as a first-class surface.
- No per-signal retention limits because current catalog consolidated retention into one `quota.retention_days`.

Recommendation:

- Add explicit features if these surfaces are tiered: `apm.requests`, `runtime_metrics.enabled`, `event_loop.enabled`, `gc_monitoring.enabled`.
- If they are always included once telemetry is enabled, document them as included sub-capabilities of `metrics.enabled` or a broader `observability.core`.
- Keep `quota.monthly_events` as the shared metering pool, but keep event credit weights visible in catalog output.

### Services

Frontend pages:

- `/:orgSlug/services`
- `/:orgSlug/services/dependencies`
- `/:orgSlug/services/slos`

Catalog meaning:

- The product has a service catalog, dependency map, and SLO management surface.

Current catalog coverage:

- No direct service catalog/SLO feature key.
- Dependency mapping is only indirectly covered by tracing.

Missing:

- `services.catalog`
- `services.dependency_map`
- `slos.enabled`
- `quota.slos`

Recommendation:

- Add these if they will be restricted by tier.
- The current `ServiceSlosPage` is static/demo-like and has "SLO creation flow coming soon"; do not sell it as generally available until backend support exists.

### Workspaces and Projects

Frontend pages:

- `/:orgSlug/projects`
- `/:orgSlug/projects/new`
- `/:orgSlug/p/:projectPublicId/overview`
- Project analytics
- Project usage
- Project activity
- Project environments
- Project API keys
- Project remote config
- Project alerts
- Project alert rules
- Project alert channels
- Project routes
- Project alert route wizard
- Project connectors
- Project alert delivery logs
- Project dead-letter queue
- Project alert preferences
- Project members
- Project settings

Catalog meaning:

- Projects are a major bounded resource.
- Many controls are project-scoped, not organization-scoped.

Current catalog coverage:

- `projects.enabled`
- `quota.projects`
- `quota.environments`
- `quota.api_keys`
- `sdk.remote_config`
- `quota.project_alert_rules`
- `quota.project_notification_channels`
- `quota.project_routing_rules`

Missing or questionable:

- Project activity/audit is not directly represented.
- Project members are shown but only org member quota exists.
- Remote config has tabs for transport, sampling, privacy, limits, killswitches, instrumentation, and features. Catalog only has broad SDK keys.
- No explicit quota for remote config rules/revisions/rollouts.
- Project delivery logs and DLQ are not cataloged.

Recommendation:

- Keep org-level and project-level quotas distinct.
- Add remote-config subfeatures if tiered: `sdk.remote_config.rollouts`, `sdk.remote_config.killswitches`, `sdk.remote_config.audit`, `quota.remote_config_rules`.
- Add delivery/DLQ features only if not included with alerting/integrations.

### Alerting / Act

Frontend pages:

- `/:orgSlug/alerts`
- Overview
- Incidents list/detail
- Raw alert events list/detail
- Rules list/detail
- Organization policy detail
- Escalations list/detail
- Templates
- Silences
- Routing
- Metrics
- Dead letters

Catalog meaning:

- Alerting is a full incident-management workflow, not just "rules".

Current catalog coverage:

- `alerting.enabled`
- `alerting.rules`
- `alerting.routing.enabled`
- `alerting.composite`
- `alerting.escalation_policies`
- `alerting.on_call`
- `alerting.incident_timeline`
- `alerting.managed_email_fallback`
- `alerting.ai_alert`
- `quota.alert_rules`
- `quota.alert_channels`
- `quota.routing_rules`
- `quota.daily_alerts`
- `quota.monthly_alerts`
- `quota.connector_sends`

Missing or questionable:

- Silences are not explicit.
- Templates are not explicit.
- Dead letters are not explicit.
- Alert metrics are not explicit.
- Incident management is partly represented by `alerting.incident_timeline`, but incident list/detail/actioning is broader.

Recommendation:

- Add `alerting.incidents`, `alerting.silences`, `alerting.templates`, `alerting.dead_letters`, `alerting.metrics` if any of these differ by plan.
- Otherwise mark them as included subfeatures of `alerting.enabled`.

### Automation / Workflows

Frontend pages:

- `/:orgSlug/automation`
- Workflows list/detail
- Runs list/detail
- Approvals list/detail
- Templates
- Events
- Audit

Catalog meaning:

- Automation is a full workflow product with run history, templates, manual events, approvals, and audit.

Current catalog coverage:

- `automation.enabled`
- `quota.automation_rules`

Missing:

- `automation.templates`
- `automation.approvals`
- `automation.audit`
- `automation.manual_events`
- `quota.automation_runs`
- `quota.automation_actions_per_workflow`

Recommendation:

- Expand automation catalog if workflows are monetized. A single boolean plus rule quota is too thin for the frontend surface.

### Ingestion / Connections

Frontend pages:

- `/:orgSlug/ingestion`
- Endpoints
- Connection health
- Keys/tokens
- Replay/pipeline
- Rate limits

Catalog meaning:

- The product exposes ingestion endpoints, key/token management, replay, pipeline health, and rate limits.

Current catalog coverage:

- `sdk.enabled`
- `integrations.rest_api`
- `quota.api_keys`
- `quota.requests_per_second`
- `quota.monthly_events`

Missing:

- `ingestion.replay`
- `ingestion.pipeline_insights`
- `ingestion.connection_health`
- Possibly `quota.ingestion_endpoints`

Recommendation:

- Decide whether ingestion replay and health are baseline operational tools or tiered features.
- If tiered, add explicit catalog keys.

### AI

Frontend pages:

- `/:orgSlug/ai`
- Assistant
- Investigations
- Reports
- Usage
- Knowledge
- Settings

Catalog meaning:

- AI is a multi-surface module: assistant, investigations, reports, knowledge, settings, usage analytics.

Current catalog coverage:

- `ai.enabled`
- `ai.summaries`
- `ai.root_cause_analysis`
- `ai.anomaly_detection`
- `ai.forecasting`
- `ai.incident_copilot`
- `quota.ai_credits`

Missing or weak:

- AI assistant is not explicit.
- AI investigations are not explicit.
- AI reports are only indirectly covered by summaries/root-cause.
- AI knowledge base is not explicit.
- AI usage page explicitly says detailed request/token/cost/cache analytics are not available.

Recommendation:

- Add `ai.assistant`, `ai.investigations`, `ai.reports`, `ai.knowledge_base`, `quota.ai_knowledge_documents`.
- Do not expose detailed AI usage analytics in catalog as available until backend usage APIs exist.

### Organization Admin / Team / Security

Frontend pages:

- `/:orgSlug/admin`
- Settings
- Domains
- Team
- Member detail
- SSO
- SCIM
- Roles
- Security events
- Audit logs
- SDK config
- Compliance

Catalog meaning:

- Enterprise admin is broad: domains, team management, SSO, SCIM, roles, security events, audit logs, SDK config, compliance.

Current catalog coverage:

- `security.enabled`
- `security.audit_logs`
- `security.sso`
- `security.scim`
- `security.custom_roles`
- `quota.members`
- `quota.custom_roles`
- `quota.service_accounts`
- `compliance.hipaa`
- `compliance.gdpr_dpa`

Missing:

- `security.verified_domains`
- `quota.verified_domains`
- `security.security_events`
- `organization.settings` if tiered
- `sdk_config.enabled` if SDK config is distinct from remote config

Recommendation:

- Add verified domain controls if domain verification/autojoin are tiered.
- Keep audit logs and security events separate. The frontend has both.

### Billing

Frontend pages:

- `/:orgSlug/billing`
- Usage
- Invoices
- Invoice detail
- Payment methods
- Checkout success/cancel
- Hidden super-admin billing catalog page: `/:orgSlug/super-admin/billing`

Catalog meaning:

- Customer billing needs current plan, usage, invoices, payment methods, and plan-change workflows.
- Super-admin catalog UI currently exists but is disconnected from canonical backend plans.

Current catalog/backend support:

- Backend has `/billing/plans`, `/billing/plans/public`, `/billing/plans/compare`, `/billing/plans/estimate`.
- Backend has subscription change/cancel/preview endpoints.
- Frontend customer billing does not call `/billing/plans`.
- Frontend `BillingPlansPage` hardcodes old `free/pro/enterprise` plan cards.

Missing:

- Catalog-driven frontend API client for plans.
- Real plan comparison UI based on five canonical tiers.
- Real plan change, downgrade, cancel, and billing portal flows.
- Super-admin catalog navigation/permission story.
- Backend compare endpoint returns plan list rather than structured diffs.

Recommendation:

- Make `/billing/plans/public` or `/billing/plans` the source of truth for both customer plan comparison and admin catalog review.
- Replace hardcoded frontend plan cards with catalog data.
- Add a typed frontend billing API module separate from `orgApi`.

### Connectors / Developer

Frontend pages:

- Webhooks list/detail
- Integrations list/detail
- Slack success/error callbacks
- Integrations audit
- Developer data retention
- Developer custom settings

Catalog meaning:

- Connectors have provider access, instance quotas, routing/delivery logs, audit, and webhook management.

Current catalog coverage:

- `integrations.enabled`
- `integrations.rest_api`
- `quota.connectors`
- `integrations.email`
- `integrations.webhook`
- `integrations.slack`
- `integrations.discord`
- `integrations.microsoft_teams`
- `integrations.pagerduty`
- `integrations.sms`
- `quota.connector_sends`

Missing:

- Connector audit logs are not explicit.
- Connector routes/delivery logs are not explicit.
- Webhook-specific quotas are not explicit.

Recommendation:

- Keep current finite provider list.
- Add delivery/audit/webhook quotas only if they are tiered. Otherwise keep them as included operations under `integrations.enabled`.

### Account/Auth

Frontend pages:

- Account overview/profile
- Password
- MFA
- Passkeys
- Recovery codes
- Active sessions
- Login history
- Linked accounts
- Authentication policy
- Privacy/deletion
- Login/register/reset/verify/step-up/SSO login

Catalog meaning:

- Mostly user-account security, not product billing.

Current catalog coverage:

- Only indirectly through security features.

Recommendation:

- Do not create billing keys for personal account security.
- Org-level SSO/auth policy belongs under enterprise security.

## Catalog Gaps That Matter Most

1. Frontend page surface is larger than the current 84-feature catalog in these areas:
   - Services and SLOs
   - Runtime metrics/event loop/GC monitoring
   - Scheduled reports
   - Automation subfeatures
   - AI assistant/investigations/reports/knowledge
   - Ingestion replay/pipeline health
   - Verified domains/security events

2. Some current catalog simplifications conflict with visible pages:
   - `dashboards.scheduled_reports` was removed, but scheduled report pages exist.
   - SLO and service dependency pages exist, but no catalog keys exist.
   - AI detailed usage analytics are displayed as unavailable, so catalog should not imply that capability is live.

3. Some frontend pages are static or placeholder-like:
   - Scheduled reports use local sample data and toast-only actions.
   - Service SLOs use local sample data and "coming soon" creation.
   - Service dependency map shows a loading/placeholder state.
   - AI usage says detailed analytics are not available.
   - Billing plan-change buttons are toast placeholders.

4. Billing UI is disconnected from backend catalog:
   - Customer plan page shows current entitlements but no catalog comparison.
   - Super-admin billing page hardcodes three old plans.
   - No frontend wrapper consumes `/billing/plans`.

## Backend Catalog Redesign Direction

### Keep Current Core

Keep these existing areas:

- Five canonical plans: `free`, `starter`, `growth`, `business`, `enterprise`
- Shared `quota.monthly_events` credit pool
- Event credit weights
- AI credits
- Finite connector provider list
- Project/environment/API-key quotas
- Alerting quotas
- Security SSO/SCIM/custom roles/audit logs

### Add or Revisit Feature Keys

Recommended additions or reconsiderations:

- `services.catalog`
- `services.dependency_map`
- `slos.enabled`
- `quota.slos`
- `apm.requests`
- `runtime_metrics.enabled`
- `event_loop.enabled`
- `gc_monitoring.enabled`
- `dashboards.scheduled_reports`
- `quota.scheduled_reports`
- `automation.templates`
- `automation.approvals`
- `automation.audit`
- `automation.manual_events`
- `ai.assistant`
- `ai.investigations`
- `ai.reports`
- `ai.knowledge_base`
- `quota.ai_knowledge_documents`
- `ingestion.replay`
- `ingestion.pipeline_insights`
- `ingestion.connection_health`
- `security.verified_domains`
- `quota.verified_domains`
- `security.security_events`

### Do Not Add Yet Unless Backend Exists

Avoid selling/gating these as production capabilities until backend support is real:

- Scheduled report delivery
- SLO creation/management
- Service dependency graph construction
- Detailed AI token/cost/cache analytics
- Billing portal/change-plan customer flow

## Implementation Checklist

1. Create a catalog-to-frontend mapping table in backend docs:
   - route group
   - page
   - capability
   - feature key
   - quota key
   - current status: live, placeholder, backend missing

2. Replace frontend `BillingPlansPage` static `PLANS` with backend `/billing/plans/public`.

3. Add a frontend billing API module:
   - `listPlans`
   - `listPublicPlans`
   - `comparePlans`
   - `estimatePricing`
   - `previewSubscriptionChange`
   - `changePlan`
   - `cancelSubscription`

4. Improve backend `/billing/plans/compare`:
   - return plan pairs or current-vs-target diff
   - include changed features, changed quotas, price delta, overage impact, and warnings

5. Update canonical catalog only after marking each frontend surface:
   - live and billable
   - live and included
   - placeholder, do not bill yet
   - internal/admin only

## Bottom Line

The frontend is already shaped like a broad observability, alerting, automation, AI, integration, and enterprise-admin platform. The backend catalog is clean and validated, but it is too compressed in several areas compared with the routed product surface. The redesign should be driven by page groups and real user workflows, not only current seed keys.

