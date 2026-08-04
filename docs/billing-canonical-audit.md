# Canonical Billing Audit

**Scope:** `src/db/postgres/canonical_migrations_draft/11_billing`,
`newupdatedfix.sql`, and the backend/frontend billing consumers.  
**Source-of-truth rule:** `newupdatedfix.sql` was assessed as the requested
latest draft, but it cannot be applied as-is; the versioned migrations and
the loader are the executable source of truth until it is reconciled.

## Executive finding

The repository already has the foundation of the canonical model: plans,
prices, a feature catalog, plan entitlements, subscription-scoped add-ons,
organization overrides, and durable daily usage. The primary failure is not a
missing model; it is two competing schema drafts plus code paths that still
read denormalized, legacy usage columns.

Do not add `organization_addons`, `plan_feature_overrides`, or
`organization_feature_usage`. They duplicate canonical tables that already
cover the same responsibilities:

| Proposed duplicate | Canonical table to retain | Reason |
| --- | --- | --- |
| `organization_addons` | `subscription_addons` | Add-ons are purchased against a subscription and already carry the org, feature, window, provider, and status. |
| `plan_feature_overrides` | `organization_feature_overrides` | Overrides are organization-specific; the existing table adds approval and effective-window auditability. |
| `organization_feature_usage` | `usage_daily_counters` + `organization_usage_current_period` | The first is the durable time series; the second is the fast current-period projection. A third aggregate would drift. |

## Migration execution and schema findings

The migration loader recursively includes every non-`.down.sql` file and
sorts lexical paths. Therefore the billing sequence includes `001`–`020`,
`025`, `026`, `addons.sql`, `addons_prices.sql`, `invoice_line_items.sql`,
`payment_methods.sql`, `newupdatedfix.sql`, and all seed files. This makes
unversioned files part of the deployable schema, not documentation.

### Blocking defects

1. `newupdatedfix.sql` recreates `billing_feature_category`, which is already
   created by `001_billing_enums.sql`; PostgreSQL fails before later changes.
2. It creates `billing_usage_behavior` twice in the same file. The second
   statement always fails even on an empty database.
3. `newupdatedfix.sql` creates competing add-on/override/usage tables rather
   than extending the canonical ones used by services.
4. It uses non-idempotent `CREATE INDEX` statements. Re-running the draft
   migration set is unsafe.
5. `organization_usage_current_period` lacks the six resource limit columns
   (`projects_limit`, `members_limit`, `api_keys_limit`, `connectors_limit`,
   `alert_rules_limit`, `dashboards_limit`) which `InternalBillingRepository`
   selects and updates. That path fails at runtime.
6. `v_effective_entitlements` excludes active subscription add-ons, whereas
   the backend resolver includes them. SQL consumers and API consumers can
   disagree.

### Existing canonical billing tables and relationships

* Catalog: `plans` → `plan_prices`; `billing_features` →
  `plan_feature_entitlements`.
* Subscription: `organization_subscriptions` links an organization to a plan;
  `subscription_events` is its audit stream.
* Entitlement modifiers: `subscription_addons` and
  `organization_feature_overrides` both reference catalog features.
* Usage: `organization_usage_current_period` is the mutable fast-path;
  partitioned `usage_daily_counters` is the durable project/day aggregate;
  `ai_usage_logs` is the AI ledger.
* Revenue: `invoices` → `payments`, `coupon_redemptions`, and line items;
  coupons use `coupon_applicable_plans`; webhook and billing audit tables are
  operational records.

### Missing indexes and constraints

* Add a partial unique index for one active override per
  `(organization_id, feature_id)`; the current table permits overlapping
  overrides and the resolver may pick an arbitrary row.
* Add a partial unique active add-on index appropriate to the provider
  reference, or enforce uniqueness in the provider webhook transaction; the
  current table permits duplicate active purchases for the same provider item.
* The effective-entitlement query needs catalog key uniqueness among
  non-deleted features (verify/retain the partial unique index in the feature
  migration) and indexes already present on subscription/entitlement joins.
* No new usage table is justified. Existing daily counters need an explicit
  organization-only upsert strategy because PostgreSQL unique constraints
  treat `NULL project_id` values as distinct.

### Obsolete or conflicting artifacts

* Treat `addons.sql` / `addons_prices.sql` as a separate product catalog only
  if the application continues to sell independent SKU metadata. They are not
  the entitlement source; `subscription_addons` is. The schema must link the
  two explicitly or the standalone catalog should be retired.
* `newupdatedfix.sql` is a reconciliation draft, not a safe migration. Its
  duplicate tables and type definitions are obsolete and must not ship.
* `organization_usage_current_period`'s hard-coded event/AI/resource columns
  are a transitional projection. Use feature-keyed entitlement resolution for
  enforcement and retain it only as a cache/projection.

## Seed audit

The `026`–`033` seeds align with the canonical catalog when applied after the
schema: plans, prices, feature catalog, dependencies, plan entitlements,
subscription add-ons, SDK defaults, and organization overrides. They should
be retained but made idempotent and kept in the same versioned migration
stream.

Remove from database seeding unless there is a documented runtime editing UI:

* `039_seed_billing_webhook_events.sql` — event names are provider/application
  constants; received events belong in the operational webhook table.
* `040_seed_email_templates.sql` and `041_seed_notification_templates.sql` —
  templates belong in application code unless administrators may edit them.
* `035_seed_invoice_templates.sql`, `036_seed_tax_configuration.sql`,
  `037_seed_coupon_templates.sql`, and `038_seed_usage_alert_policies.sql`
  require an existing, product-owned runtime table and UI; otherwise they
  should be code configuration, not seeds.
* `034_seed_usage_billing_rules.sql` duplicates the feature catalog's
  entitlement/usage behavior. Merge its semantics into feature metadata.

The generic migration loader now excludes these audited application-constant
and demo seeds (`032`–`041`) by filename. It continues to apply the compatible
plan/price/catalog/entitlement seeds while incompatible dependency and add-on
drafts are held back for replacement.

Subsequent validation also excludes `029_seed_feature_dependencies.sql` and
`031_seed_plan_addons.sql`: the first names a retired
`billing_feature_dependencies` table and the second attempts to insert product
catalog records into `subscription_addons` (which represents purchased
organization subscriptions). Both require a replacement, ID-backed catalog
seed before being re-enabled.

Those replacements are now supplied as `029b_seed_feature_dependencies_canonical.sql`
and `031b_seed_addon_catalog_canonical.sql`. They seed `feature_dependencies`
by catalog IDs and `addons`/`addon_prices` by product key respectively; neither
creates organization-specific purchase records.

## Dependency map

```text
Plans + prices + features + entitlements
  -> organization subscriptions + overrides + subscription add-ons
  -> EntitlementsRepository (effective feature values)
  -> Billing APIs, organization quotas, provisioning, SDK configuration

SDK -> ingestion API -> API-key/project lookup -> quota pre-check
  -> pg-boss ingest jobs -> normalization/persistence workers
  -> usage-counter staging -> usage-rollup
  -> usage_daily_counters + current-period projection -> billing usage/invoice jobs
```

Current direct consumers include the billing plans, subscription, add-on,
provisioning, invoice, internal, and jobs repositories; organization quota
services; AI usage; ingestion gateway/workers; project API key and SDK config
services; and the billing pages in `pulsiv_fe`.

## Usage and ingestion assessment

The event pipeline already has a sensible durable path (gateway → pg-boss →
worker → staged counters → daily/current-period rollup). It does **not** fully
support the canonical model because enforcement is still based on the
hard-coded `event_limit` and plan tier, while effective entitlements are
resolved separately. The correct integration point is the ingestion gateway's
quota pre-check for low-latency admission, with an authoritative transactional
check immediately before the worker commits usage. The worker must report a
feature key and requested quantity to a single entitlement/usage facade.

## Required design and implementation order

1. Reconcile migrations: make the source-of-truth migration additive and
   idempotent; extend existing tables only.
2. Centralize effective entitlement resolution: plan → organization override
   → active subscription add-ons, including feature dependencies and
   configuration metadata.
3. Add one usage-enforcement facade that locks the current-period row,
   resolves the feature, applies `usage_behavior`, and records usage
   idempotently. Replace direct quota decisions incrementally.
4. Derive SDK configuration from entitlement values/defaults and then project
   and environment settings; do not gate on plan tier strings.
5. Expose plans, subscription, usage, entitlement, add-on, invoice, and
   coupon data through backend APIs. The frontend must consume those APIs;
   it currently has billing pages but also broad dummy-data usage.

## Implemented reconciliation

The source-of-truth migration now implements items 1 and the SQL read-model
part of item 2. `InternalBillingService` now resolves `monthly_events`,
`ai_credits`, and all resource limits from effective entitlements when it
enforces usage; cached columns are no longer authoritative. The ingestion
gateway's admission cache reads that same `monthly_events` entitlement and
only rejects an exhausted quota when its catalog behavior is `hard_limit` or
`throttle`. This leaves soft limits and overages admissible for the
authoritative billing consumption path to record.

SDK delivery now resolves `sdk.remote_config` and the mapped observability
features from `v_effective_entitlements` before returning a snapshot. A plan
downgrade, override expiry, or add-on change therefore takes effect at the
delivery boundary: it can deny remote config entirely or force individual SDK
capabilities off while retaining the validated project/environment intent.
The override is supplied by the SDK service composition root, rather than the
HTTP adapter, so every delivery caller receives the same policy.

The billing plan frontend now reads `/billing/entitlements` and renders the
resolved feature map dynamically. This removes the fixed plan-feature list
from the subscription display; new catalog entries, overrides, and add-ons no
longer require a UI release merely to be visible.

Organization and project creation guards now prioritize the canonical
`quota.members`, `quota.projects`, `quota.environments`, and `quota.api_keys`
entitlements (with legacy aliases only as a transition fallback). This removes
the remaining key-name mismatch between the seeded catalog and resource-limit
enforcement.

The centralized billing and ingestion paths also now prefer
`quota.monthly_events` and `quota.ai_credits`; their legacy equivalents are
used only if the canonical entitlement is absent. The ingestion query selects
the canonical entry deterministically when both generations are present.

The entitlement-refresh job and organization billing summary use the same
canonical quota preference, preventing asynchronous cached-limit refreshes or
summary reads from restoring legacy values after enforcement has resolved the
new catalog.

## Validation baseline

The stale disabled-Redis shutdown reference was removed and `npm run build`
now passes. Focused SDK-delivery and typed-ingestion tests pass (7/7).
PostgreSQL migration execution is still unverified locally:
`psql` is not installed and the local Docker daemon is unavailable.

## Final canonical inventory

### Runtime tables

* Catalog and entitlements: `plans`, `plan_prices`, `billing_features`,
  `feature_dependencies`, `plan_feature_entitlements`,
  `organization_feature_overrides`.
* Subscription and purchases: `organization_subscriptions`,
  `subscription_events`, `subscription_addons`, `addons`, `addon_prices`.
* Usage: `organization_usage_current_period`, `usage_daily_counters`, and
  `ai_usage_logs` (including their time partitions).
* Revenue and payment operations: `invoices`, `invoice_line_items`,
  `payments`, `payment_methods`, `coupons`, `coupon_applicable_plans`, and
  `coupon_redemptions`.
* Operations and audit: `billing_webhook_events` and `billing_audit_logs`
  (including their time partitions).

No new organization-level add-on, override, entitlement, or usage aggregate
table is part of the final model.

### Retained seed files

* `026_seed_plans.sql`, `027_seed_plan_prices.sql`.
* All `028*` billing-feature catalog seeds.
* `029b_seed_feature_dependencies_canonical.sql`.
* `030a` through `030d` plan-entitlement seeds.
* `031b_seed_addon_catalog_canonical.sql`.

The loader intentionally skips `029`, `031`, and `032` through `041`.
`029` and `031` are replaced by the ID-backed canonical seeds above; the
remaining skipped files target retired table shapes, demo organization data,
or application-owned constants rather than persistent billing state.

Run `npm run db:migrate:draft` once to establish the schema, then run
`npm run db:seed:billing` to seed or reconcile just this retained billing
catalog. `npm run db:seed:billing -- --dry-run` prints its ordered seed set
without writing to PostgreSQL.

### Merged and rejected draft changes

Merged from the draft: feature usage behavior and configuration metadata,
plan/subscription versioning metadata, entitlement configuration/display
metadata, cached usage projection columns, feature dependencies, the active
override uniqueness rule, supporting indexes, and the effective-entitlement
view that applies plan, override, and active subscription add-on precedence.

Rejected from the draft: re-created enums, repeated enum creation, duplicate
usage/override/add-on tables, and unguarded index creation. Each would either
break idempotent migration execution or establish a second source of truth.
