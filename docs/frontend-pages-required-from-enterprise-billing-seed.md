# Frontend Pages Required From Enterprise Billing Seed

## Scope

This document compares the new billing seed:

- `pulse/src/db/postgres/canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql`

against:

- frontend routes/pages in `pulsiv_fe/src`
- backend APIs in `pulse/src/modules`
- database schema under `pulse/src/db/postgres/canonical_migrations_draft` only

The new seed is a feature and entitlement catalog. It does not mean every feature has full runtime schema or API yet. Some features are future-ready catalog entries and need schema/API/page work before they can be fully operational.

## Frontend Should Use This Rule

Sidebar and module visibility should be entitlement-driven:

- Show a module when its `billing_features.module` has an `is_module_root = true` feature with `booleanValue = true`.
- Show an upgrade state when the module root is false but an add-on exists for that module.
- Group plan comparison and admin controls by `billing_features.metadata.frontendGroup`.

Do not hardcode old entitlement names like:

- `max_projects`
- `max_environments`
- `max_team_members`
- `event_limit_monthly`
- `sso_saml`

The new canonical keys are:

- `limit_projects_max`
- `limit_environments_max`
- `limit_members_max`
- `monthly_events`
- `module_enterprise_features_sso`

## Current Frontend Pages Found

### Billing

Implemented:

- `/billing` -> `pulsiv_fe/src/pages/billing/PlanPage.tsx`
- `/billing/usage` -> `BillingUsagePage.tsx`
- `/billing/invoices` -> `InvoicesPage.tsx`
- `/billing/invoices/:invoiceId` -> `InvoiceDetailPage.tsx`
- `/billing/payment-methods` -> `PaymentMethodsPage.tsx`
- `/billing/checkout/success`
- `/billing/checkout/cancel`
- `/super-admin/billing` -> `BillingPlansPage.tsx`

### Observe

Implemented:

- `/observability`
- `/observability/requests`
- `/observability/events`
- `/observability/errors`
- `/observability/service-health`
- `/observability/latency`
- `/observability/traces`
- `/observability/logs`

Missing as dedicated pages:

- `/observability/metrics`
- `/observability/profiling`
- `/observability/replays`
- `/observability/cron`
- `/observability/uptime`
- `/observability/users`
- `/observability/sessions`

### Act

Implemented routes/pages:

- `/alerts`
- `/alerts/:incidentId`
- `/alerts/rules`
- `/alerts/rules/:ruleId`
- `/alerts/escalations`
- `/alerts/escalations/:policyId`
- `/alerts/channels`
- `/alerts/channels/:channelId`

Missing as dedicated pages:

- `/alerts/events`
- `/alerts/silences`
- `/alerts/templates`
- `/alerts/routing`
- `/alerts/metrics`
- `/alerts/dead-letters`

### Connections / Connectors

Implemented:

- `/connectors/integrations`
- `/connectors/integrations/:integrationId`
- `/connectors/audit`
- `/connectors/webhooks`
- `/connectors/webhooks/:webhookId`
- `/ingestion`
- `/ingestion/endpoints`
- `/ingestion/health`
- `/ingestion/keys`
- `/ingestion/replay`
- `/ingestion/rate-limits`

Missing as dedicated pages:

- `/connectors/deliveries`
- `/connectors/deliveries/:deliveryId`
- `/connectors/routes`
- `/connectors/health`
- `/connectors/test-runs`

### AI

Implemented:

- `/ai`
- `/ai/root-cause`
- `/ai/anomalies`
- `/ai/release-impact`
- `/ai/costs`
- `/ai/policies`

Missing as dedicated pages:

- `/ai/chat`
- `/ai/reports`
- `/ai/evaluations`
- `/ai/knowledge`
- `/ai/usage-receipts`

### Organization / Enterprise

Implemented:

- `/admin`
- `/admin/team`
- `/admin/sso`
- `/admin/scim`
- `/admin/domains`
- `/admin/security-events`
- `/admin/audit-logs`
- `/admin/compliance`
- `/admin/settings`
- `/admin/roles`
- `/admin/sdk-config`

Missing as dedicated pages:

- `/admin/ip-allowlist`
- `/admin/data-export-controls`
- `/admin/data-residency`
- `/admin/private-networking`
- `/admin/custom-domains`
- `/admin/custom-retention`

### Version Management

Partially represented:

- `/dashboards/releases`
- `/ai/release-impact`
- event tables have `release` and `sdk_version` columns
- SDK config API has version rollback/ack endpoints

Missing as first-class module pages:

- `/releases`
- `/releases/:releaseId`
- `/releases/deploys`
- `/releases/health`
- `/releases/regressions`
- `/releases/gates`

### Automation

Missing:

- `/automation`
- `/automation/workflows`
- `/automation/workflows/new`
- `/automation/workflows/:workflowId`
- `/automation/approvals`
- `/automation/runs`

## Required Pages By Seeded Module

| Seed module | Frontend status | Required pages |
|---|---:|---|
| `organization` | Partial | `/admin`, `/admin/team`, plus single-org policy UI in org switcher/onboarding |
| `projects` | Partial | `/projects`, project details, plus project limit banners |
| `error_tracking` | Partial | `/observability/errors`, detail actions need backend wiring |
| `distributed_tracing` | Partial | `/observability/traces`, service map/detail pages need backend wiring |
| `logging` | Partial | `/observability/logs`, live tail UI missing |
| `metrics` | Missing dedicated page | `/observability/metrics`, metric detail, metric alerts |
| `profiling` | Missing | `/observability/profiling`, profile detail, diff view |
| `session_replay` | Missing | `/observability/replays`, replay detail |
| `cron_monitoring` | Missing | `/observability/cron`, cron detail/history |
| `uptime_monitoring` | Missing | `/observability/uptime`, monitor detail, status pages |
| `version_management` | Partial | `/releases`, release detail, deploys, gates |
| `incident_management` | Partial | `/alerts` exists, but event/timeline/postmortem actions need API/schema alignment |
| `ai_insights` | Partial | `/ai` exists, but chat/reports/knowledge/evaluations pages missing |
| `alerting` | Partial | rules/escalations/channels exist, but silences/templates/routing/events/dead letters missing |
| `connectors` | Partial | integrations/audit exist, but deliveries/routes/health/test-runs pages missing |
| `analytics` | Partial | dashboards exist, but custom dashboard CRUD/query builder needs wiring |
| `sdk` | Partial | `/admin/sdk-config` exists |
| `automation` | Missing | all automation pages missing |
| `enterprise` | Partial | SSO/SCIM/audit/compliance exist, but private networking/data residency/IP allowlist/custom retention missing |
| `support` | Missing | support plan/contact/success manager page missing |
| `billing_ops` | Partial | billing pages exist, but add-ons, history, refunds, audit logs, tax profile, portal wiring missing |

## Database Schema Coverage From Canonical Draft Only

### Schema Exists

Billing:

- `plans`
- `plan_prices`
- `billing_features`
- `plan_feature_entitlements`
- `organization_subscriptions`
- `subscription_events`
- `subscription_addons`
- `organization_feature_overrides`
- `organization_usage_current_period`
- `usage_daily_counters`
- `ai_usage_logs`
- `invoices`
- `payments`
- `billing_webhook_events`
- `coupons`
- `coupon_redemptions`
- `coupon_applicable_plans`
- `billing_audit_logs`
- `addons`
- `addon_prices`
- `invoice_line_items`
- `payment_methods`

Observability:

- `events_errors`
- `events_requests`
- `events_metrics`
- `events_messages`
- `events_traces`
- `events_logs`
- `events_profiles`
- `events_cron_checkins`
- `events_replays`

AI:

- `ai_requests`
- `credit_balances`
- `knowledge_documents`
- `knowledge_chunks`
- `ai_evaluations`
- `ai_reports`
- `ai_usage_receipts`
- `ai_conversations`
- `ai_chat_requests`
- `ai_conversation_messages`
- `ai_tool_calls`

Enterprise identity and audit:

- SSO/SCIM-related org identity tables under `03_org_identity`
- `audit_logs`
- enhanced audit indexes

Projects and SDK:

- project tables under `04_projects`
- project settings
- SDK config/version surfaces exist in runtime and draft-adjacent project/org schemas

Connectors and alerting:

- connectors tables under `06_connectors`
- notification tables under `07_notifications`
- alerting-related runtime schema exists in canonical draft through alerting/notification modules

### Schema Missing Or Only Indirect

The seed includes future-ready features for these modules, but canonical draft does not yet have dedicated first-class schema for them:

- `uptime_monitoring`: no dedicated uptime monitor/status page tables found; only generic analytics/events can support partial views.
- `version_management`: no first-class `releases`, `deployments`, `release_gates`, or `release_health` tables found; release exists as a column on event tables.
- `incident_management`: no dedicated `incidents`, `incident_timelines`, `postmortems`, or `on_call_rotations` tables found; alert events can support a partial incident view.
- `automation`: no workflow, approval, workflow-run, or scheduled-workflow tables found.
- `support`: no support ticket, onboarding, or success-manager tables found.
- `private_networking`: no VPC/private endpoint schema found.
- `custom_domains`: org identity has verified domains, but no product custom-domain/status-page domain schema found.
- `data_export_controls`: no dedicated export policy schema found.
- `data_residency`: compliance/settings may store this indirectly, but no dedicated residency policy table found.

## Backend API Coverage

### Billing APIs Exist

Plan and pricing:

- `GET /billing/plans`
- `GET /billing/plans/public`
- `GET /billing/plans/compare`
- `GET /billing/plans/:planId`
- `POST /billing/plans/estimate`

Subscription:

- `GET /billing/subscription`
- `GET /billing/subscription/summary`
- `GET /billing/subscription/history`
- `POST /billing/subscription`
- `POST /billing/subscription/change-plan`
- `POST /billing/subscription/preview-change`
- `POST /billing/subscription/scheduled-change`
- `POST /billing/subscription/upgrade`
- `POST /billing/subscription/downgrade`
- `POST /billing/subscription/cancel`

Add-ons:

- `GET /billing/addons`
- `GET /billing/addons/subscription`
- `POST /billing/addons/subscription`
- `DELETE /billing/addons/subscription/:subscriptionAddonId`
- `GET /billing/subscription/addons`
- `POST /billing/subscription/addons`
- `DELETE /billing/subscription/addons/:subscriptionAddonId`

Usage:

- `GET /billing/usage/current`
- `GET /billing/usage/daily`
- `GET /billing/usage/project-attribution`
- `GET /billing/usage/api-key-attribution`
- `POST /billing/usage/increment-events`

Invoices and payments:

- `GET /billing/invoices`
- `GET /billing/invoices/upcoming`
- `GET /billing/invoices/:invoiceId`
- `POST /billing/invoices/:invoiceId/pay`
- `GET /billing/payments`
- `POST /billing/payments/:paymentId/refund`
- `POST /billing/refunds`

Payment methods:

- `GET /billing/payment-methods`
- `POST /billing/payment-methods`
- `POST /billing/payment-methods/:paymentMethodId/default`
- `DELETE /billing/payment-methods/:paymentMethodId`

Provider surfaces:

- `POST /billing/checkout/sessions`
- `POST /billing/customer-portal`
- `POST /billing/credit-notes`
- `PUT /billing/tax-profile`

Coupons and audit:

- `GET /billing/coupons/validate`
- `POST /billing/coupons/apply`
- `GET /billing/audit-logs`

Entitlements:

- `GET /billing/entitlements`
- `POST /billing/entitlements/check`

### Observability APIs Exist

Mounted under:

- `/organizations/:orgId/analytics`

Relevant endpoints:

- `GET /overview`
- `GET /trends`
- `GET /health`
- `GET /errors`
- `GET /errors/groups`
- `POST /errors/groups/:fingerprint/resolve`
- `POST /errors/groups/:fingerprint/ignore`
- `GET /requests`
- `GET /requests/:id`
- `GET /traces`
- `GET /traces/:traceId`
- `GET /metrics`
- `GET /metrics/:name`
- `GET /logs`
- `GET /logs/stream`
- `GET /sessions`
- `GET /sessions/:sessionId`
- `GET /users`
- `GET /users/:userId`
- `GET /crons`
- `GET /crons/:slug`
- `GET /crons/:slug/history`
- `POST /dashboards`
- `GET /dashboards`
- `PATCH /dashboards/:id`
- `DELETE /dashboards/:id`
- `POST /dashboards/:id/duplicate`
- `POST /queries`
- `GET /queries`
- `DELETE /queries/:id`
- `POST /queries/:id/execute`
- `POST /alerts`
- `GET /alerts`
- `DELETE /alerts/:id`
- `POST /export`

Missing API for seed modules:

- first-class profiling detail/diff API
- first-class replay playback API
- first-class uptime monitor CRUD API
- first-class release/deploy/gate API

### Alerting APIs Exist

Mounted under:

- `/organizations/:orgId/alerting`

Important endpoints:

- rules CRUD, enable, disable, test, clone
- alert events list/detail/acknowledge/resolve/silence/deliveries
- dead-letter list/retry/discard
- escalation policies CRUD and steps
- silences CRUD
- templates CRUD and preview
- routing rules CRUD and test
- metrics endpoint

Missing frontend pages for existing APIs:

- alert events page
- silences page
- templates page
- routing page
- alerting metrics page
- dead-letter page

### Connectors APIs Exist

Mounted under:

- `/organizations/:orgId/connectors`

Important endpoints:

- connector types
- connector CRUD
- enable/disable
- rotate secret
- test
- health check
- health history
- test runs
- send
- deliveries
- delivery retry
- delivery attempts
- audit
- connector routes CRUD
- OAuth start/callback/refresh/disconnect
- preview
- validate configuration
- Slack channels

Missing frontend pages/buttons for existing APIs:

- delivery detail page
- delivery retry button
- delivery attempts panel
- connector health-check button
- connector test button
- rotate secret button
- enable/disable connector button
- OAuth disconnect/refresh buttons
- connector route create/update/delete UI
- config preview/validate button

## Missing Buttons Where Backend API Already Exists

### Billing Plan Page

Current issue:

- `PlanPage.tsx` shows toast placeholders for `Billing Portal` and `Upgrade Plan`.
- It uses old entitlement labels and does not consume `/billing/plans/compare` or `/billing/entitlements`.

Buttons/actions to add:

- `Open billing portal` -> `POST /billing/customer-portal`
- `Compare plans` -> `GET /billing/plans/compare`
- `Estimate price` -> `POST /billing/plans/estimate`
- `Preview plan change` -> `POST /billing/subscription/preview-change`
- `Upgrade plan` -> `POST /billing/subscription/upgrade` or `POST /billing/subscription/change-plan`
- `Downgrade plan` -> `POST /billing/subscription/downgrade`
- `Schedule change` -> `POST /billing/subscription/scheduled-change`
- `Cancel subscription` -> `POST /billing/subscription/cancel`
- `Start checkout` -> `POST /billing/checkout/sessions`

### Billing Add-ons

Missing page:

- `/billing/addons`

Buttons/actions to add:

- `View available add-ons` -> `GET /billing/addons`
- `View active add-ons` -> `GET /billing/addons/subscription`
- `Subscribe add-on` -> `POST /billing/addons/subscription`
- `Cancel add-on` -> `DELETE /billing/addons/subscription/:subscriptionAddonId`

### Billing Usage

Current page exists, but should add:

- `Project attribution` -> `GET /billing/usage/project-attribution`
- `API key attribution` -> `GET /billing/usage/api-key-attribution`
- `Export usage` -> use existing frontend export pattern or backend export endpoint if added later

### Invoices

Current pages exist, but should add:

- `Upcoming invoice` panel -> `GET /billing/invoices/upcoming`
- `Pay invoice` button -> `POST /billing/invoices/:invoiceId/pay`
- `Refund payment` admin action -> `POST /billing/payments/:paymentId/refund`
- `Create refund` admin action -> `POST /billing/refunds`
- `Create credit note` admin action -> `POST /billing/credit-notes`

### Payment Methods

Current page has a route mismatch:

- Frontend uses `PATCH /billing/payment-methods/:paymentMethodId/default`
- Backend exposes `POST /billing/payment-methods/:paymentMethodId/default`

Fix required:

- Change frontend API method from `patch` to `post`.

### Coupons

Missing page/section:

- coupon apply box on `/billing`
- coupon management in `/super-admin/billing`

Buttons/actions:

- `Validate coupon` -> `GET /billing/coupons/validate`
- `Apply coupon` -> `POST /billing/coupons/apply`

### Billing Audit and Webhooks

Missing pages:

- `/billing/audit-logs`
- `/super-admin/billing/webhooks`

Buttons/actions:

- `Retry webhook event` -> `POST /billing/webhooks/events/:eventId/retry`
- `View billing audit logs` -> `GET /billing/audit-logs`

### Alert Rules

Pages exist, but ensure these buttons are present:

- `Create rule` -> `POST /organizations/:orgId/alerting/rules`
- `Create from template` -> `POST /organizations/:orgId/alerting/rules/templates/:templateKey`
- `Enable` -> `POST /organizations/:orgId/alerting/rules/:id/enable`
- `Disable` -> `POST /organizations/:orgId/alerting/rules/:id/disable`
- `Test` -> `POST /organizations/:orgId/alerting/rules/:id/test`
- `Clone` -> `POST /organizations/:orgId/alerting/rules/:id/clone`
- `Delete` -> `DELETE /organizations/:orgId/alerting/rules/:id`

### Alert Events / Incidents

Pages partially exist, but incident/event action buttons should use:

- `Acknowledge` -> `POST /organizations/:orgId/alerting/events/:id/acknowledge`
- `Resolve` -> `POST /organizations/:orgId/alerting/events/:id/resolve`
- `Silence` -> `POST /organizations/:orgId/alerting/events/:id/silence`
- `View deliveries` -> `GET /organizations/:orgId/alerting/events/:id/deliveries`

### Dead Letters

Project dead-letter page exists, but alerting dead-letter page is missing.

Buttons/actions:

- `Retry` -> `POST /organizations/:orgId/alerting/dead-letters/:id/retry`
- `Discard` -> `DELETE /organizations/:orgId/alerting/dead-letters/:id`

### Connectors

Pages exist but should expose all backend actions:

- `Create connector` -> `POST /organizations/:orgId/connectors`
- `Edit connector` -> `PATCH /organizations/:orgId/connectors/:id`
- `Delete connector` -> `DELETE /organizations/:orgId/connectors/:id`
- `Enable` -> `POST /organizations/:orgId/connectors/:id/enable`
- `Disable` -> `POST /organizations/:orgId/connectors/:id/disable`
- `Rotate secret` -> `POST /organizations/:orgId/connectors/:id/rotate-secret`
- `Test` -> `POST /organizations/:orgId/connectors/:id/test`
- `Health check` -> `POST /organizations/:orgId/connectors/:id/health-check`
- `Send test payload` -> `POST /organizations/:orgId/connectors/:id/send`
- `Retry delivery` -> `POST /organizations/:orgId/connectors/deliveries/:deliveryId/retry`
- `Preview config` -> `POST /organizations/:orgId/connectors/preview`
- `Validate config` -> `POST /organizations/:orgId/connectors/validate-configuration`
- `OAuth refresh` -> `POST /organizations/:orgId/connectors/:id/oauth/refresh`
- `OAuth disconnect` -> `POST /organizations/:orgId/connectors/:id/oauth/disconnect`

### Observability

Buttons/actions to add where pages exist:

- Error group `Resolve` -> `POST /organizations/:orgId/analytics/errors/groups/:fingerprint/resolve`
- Error group `Ignore` -> `POST /organizations/:orgId/analytics/errors/groups/:fingerprint/ignore`
- Dashboard `Create` -> `POST /organizations/:orgId/analytics/dashboards`
- Dashboard `Duplicate` -> `POST /organizations/:orgId/analytics/dashboards/:id/duplicate`
- Dashboard `Delete` -> `DELETE /organizations/:orgId/analytics/dashboards/:id`
- Query `Execute` -> `POST /organizations/:orgId/analytics/queries/:id/execute`
- Analytics alert `Create` -> `POST /organizations/:orgId/analytics/alerts`
- Analytics alert `Delete` -> `DELETE /organizations/:orgId/analytics/alerts/:id`
- Export -> `POST /organizations/:orgId/analytics/export`

## Highest-Priority Frontend Work

1. Replace old billing feature keys in `PlanPage.tsx` with canonical entitlement keys from `/billing/entitlements` or `/billing/plans/compare`.
2. Add entitlement-aware sidebar gating from `module` and `isModuleRoot`.
3. Add `/billing/addons`.
4. Wire `Billing Portal`, `Upgrade Plan`, `Preview Change`, `Cancel Subscription`, and `Checkout` buttons to existing billing APIs.
5. Fix payment method default route from `PATCH` to `POST`.
6. Add missing observe pages for metrics, profiling, replays, cron, and uptime.
7. Add missing alerting operation pages for events, silences, templates, routing, metrics, and dead letters.
8. Add missing connector operation pages for deliveries, health, routes, and test runs.
9. Create first-class release/version management pages, then add backend schema/API for releases and deploy gates.
10. Create automation pages only after workflow schema/API exists.

