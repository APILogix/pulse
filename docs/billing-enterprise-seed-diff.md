# Billing Enterprise Seed Diff

## Added File

- `src/db/postgres/canonical_migrations_draft/11_billing/026_enterprise_module_billing_seed.sql`

## Scope

This change adds a new global billing catalog seed only. It does not change billing schema DDL and does not seed organization-specific rows.

No rows are inserted into:

- `organizations`
- `organization_subscriptions`
- `organization_usage_current_period`
- `organization_feature_overrides`
- `subscription_events`

The single-organization product policy is represented as a global entitlement:

- `limit_organizations_max = 1` for `free`, `starter`, `growth`, `business`, and `enterprise`

## Plan Catalog Changes

The seed upserts the canonical five billing plans:

- `free`
- `starter`
- `growth`
- `business`
- `enterprise`

It also upserts Stripe monthly and annual prices for:

- `starter`
- `growth`
- `business`

Enterprise remains custom-priced and not public.

## Feature Catalog Changes

The new seed creates a module-wise entitlement matrix using a temporary table:

- One row per feature.
- One value per plan in the same row.
- Values are normalized into `plan_feature_entitlements`.
- Runtime reads stay fast because the application still queries indexed normalized tables.

Total feature rows added/managed by the new seed:

- `153`

Feature keys are grouped by `module` and include frontend metadata:

- `metadata.frontendGroup`
- `metadata.reset`
- `metadata.meter`
- `metadata.enforcement`
- `metadata.catalog = enterprise-module-v1`

## Major Modules Covered

- `limits`
- `organization`
- `projects`
- `error_tracking`
- `distributed_tracing`
- `logging`
- `metrics`
- `profiling`
- `session_replay`
- `cron_monitoring`
- `uptime_monitoring`
- `version_management`
- `incident_management`
- `ai_insights`
- `alerting`
- `connectors`
- `analytics`
- `sdk`
- `automation`
- `enterprise`
- `support`
- `billing_ops`

## Important New Future-Ready Features

Version management:

- `module_version_management_enabled`
- `module_version_management_features_deploy_tracking`
- `module_version_management_features_release_health`
- `module_version_management_features_regression_detection`
- `module_version_management_features_changelog_annotations`
- `module_version_management_features_release_gates`
- `limit_releases_max`

Incident management:

- `module_incident_management_enabled`
- `module_incident_management_features_timelines`
- `module_incident_management_features_root_cause`
- `module_incident_management_features_postmortems`
- `module_incident_management_features_on_call_routing`

Monitoring expansion:

- `limit_monitors_max`
- `limit_status_pages_max`
- `module_logging_features_sensitive_data_scrubbing`
- `module_metrics_features_cardinality_management`
- `module_distributed_tracing_features_service_map`
- `module_distributed_tracing_features_sampling_controls`

Automation:

- `module_automation_enabled`
- `module_automation_features_webhooks`
- `module_automation_features_scheduled_workflows`
- `module_automation_features_approval_steps`

Billing operations:

- `module_billing_ops_enabled`
- `module_billing_ops_invoice_history`
- `module_billing_ops_payment_methods`
- `module_billing_ops_coupons`
- `module_billing_ops_cost_alerts`

Enterprise controls:

- `module_enterprise_features_ip_allowlist`
- `module_enterprise_features_custom_roles`
- `module_enterprise_features_data_export_controls`
- `module_enterprise_features_private_networking`
- `module_enterprise_features_dedicated_workers`
- `module_enterprise_data_residency`

## Add-ons Added or Updated

Module add-ons:

- `session_replay`
- `profiling`
- `cron_monitoring`
- `uptime_monitoring`
- `version_management`
- `incident_management`

Capacity add-ons:

- `ai_credits`
- `extra_events`
- `extra_projects`
- `extra_members`
- `extra_connectors`
- `extra_alert_rules`
- `extra_releases`
- `extended_retention`

Enterprise feature add-ons:

- `private_networking`
- `custom_domains`
- `data_residency`
- `dedicated_workers`

## Reset Behavior Metadata

The seed adds metadata to make reset behavior frontend-readable and backend-friendly:

- Monthly reset examples:
  - `monthly_events`
  - `module_ai_insights_monthly_credits`
  - `limit_releases_max`
- Rolling retention examples:
  - `module_error_tracking_retention_days`
  - `module_logging_retention_days`
  - `module_metrics_retention_days`
- Never-reset examples:
  - `limit_organizations_max`
  - `limit_projects_max`
  - `limit_members_max`

## Frontend Sidebar Handling

The frontend should not hardcode plan feature availability inside sidebar components. It should build the sidebar from the effective entitlement payload.

Recommended data shape after fetching billing entitlements:

```ts
type BillingFeature = {
  featureKey: string;
  module: string | null;
  isModuleRoot: boolean;
  valueType: "boolean" | "integer" | "decimal" | "string";
  booleanValue?: boolean | null;
  integerValue?: number | null;
  decimalValue?: number | null;
  stringValue?: string | null;
  metadata?: {
    frontendGroup?: string;
    reset?: "monthly" | "rolling" | "never";
    meter?: string;
    enforcement?: string;
    catalog?: string;
  };
};
```

Sidebar module visibility should use root feature rows:

```ts
function canShowModule(features: BillingFeature[], moduleKey: string) {
  return features.some((feature) => {
    return feature.module === moduleKey
      && feature.isModuleRoot
      && feature.valueType === "boolean"
      && feature.booleanValue === true;
  });
}
```

Recommended sidebar module map:

```ts
const sidebarModules = [
  { key: "error_tracking", label: "Errors", route: "/errors" },
  { key: "distributed_tracing", label: "Tracing", route: "/traces" },
  { key: "logging", label: "Logs", route: "/logs" },
  { key: "metrics", label: "Metrics", route: "/metrics" },
  { key: "profiling", label: "Profiling", route: "/profiling" },
  { key: "session_replay", label: "Replays", route: "/replays" },
  { key: "cron_monitoring", label: "Cron", route: "/cron" },
  { key: "uptime_monitoring", label: "Uptime", route: "/uptime" },
  { key: "version_management", label: "Releases", route: "/releases" },
  { key: "incident_management", label: "Incidents", route: "/incidents" },
  { key: "ai_insights", label: "AI Insights", route: "/ai" },
  { key: "alerting", label: "Alerts", route: "/alerts" },
  { key: "connectors", label: "Connectors", route: "/connectors" },
  { key: "analytics", label: "Analytics", route: "/analytics" },
  { key: "automation", label: "Automation", route: "/automation" },
  { key: "enterprise", label: "Security", route: "/security" },
  { key: "billing_ops", label: "Billing", route: "/billing" }
];
```

Render logic:

```ts
const visibleSidebarModules = sidebarModules.filter((item) => {
  return canShowModule(effectiveBillingFeatures, item.key);
});
```

Feature-level controls inside each module should use non-root feature rows:

```ts
function getModuleFeatures(features: BillingFeature[], moduleKey: string) {
  return features
    .filter((feature) => feature.module === moduleKey && !feature.isModuleRoot)
    .sort((a, b) => a.featureKey.localeCompare(b.featureKey));
}
```

For disabled modules that exist as purchasable add-ons, the sidebar can show an upgrade state instead of hiding the route completely:

```ts
type SidebarState = "enabled" | "upgrade" | "hidden";

function getSidebarState(
  features: BillingFeature[],
  purchasableAddonKeys: Set<string>,
  moduleKey: string
): SidebarState {
  if (canShowModule(features, moduleKey)) {
    return "enabled";
  }

  if (purchasableAddonKeys.has(moduleKey)) {
    return "upgrade";
  }

  return "hidden";
}
```

## Frontend Plan Management Handling

Plan comparison pages should group by `metadata.frontendGroup` or `module`.

Suggested groups:

- `limits`
- `errorTracking`
- `tracing`
- `logging`
- `metrics`
- `profiling`
- `sessionReplay`
- `cronMonitoring`
- `uptimeMonitoring`
- `versionManagement`
- `incidentManagement`
- `aiInsights`
- `alerting`
- `connectors`
- `analytics`
- `sdk`
- `automation`
- `enterprise`
- `support`
- `billingOps`

Integer values:

- `-1` means unlimited.
- Display as `Unlimited`.

Boolean values:

- `true` means included.
- `false` means not included or requires upgrade/add-on.

Decimal values:

- Sampling rates are stored as decimals such as `0.1`, `0.2`, `1.0`.
- Display them as percentages when the feature key ends in `_rate`.

String values:

- Display directly for levels, SLA, data residency, support tier, and response time.

## Verification Performed

Commands run:

```bash
npm test -- test\scripts\canonical-migrations-draft.unit.test.ts test\unit\billing-provisioning.test.ts test\unit\billing-usage.test.ts
npm run build
npm run test:integration -- test\integration\canonical-migrations-draft.test.ts
```

Results:

- Unit tests passed.
- TypeScript build passed.
- Draft integration test started, but the actual Postgres bootstrap was skipped because no working container runtime was available.

