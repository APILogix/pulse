# Pulsiv Billing Catalog Abnormalities & Enterprise-Grade SaaS Billing Catalog Architecture (v3)

This document provides:
1. **Plan-by-Plan Catalog Abnormalities**: Every contradiction, dead quota, unbillable overage rule, and runtime bug across all 5 plans (`free`, `starter`, `growth`, `business`, `enterprise`).
2. **Cross-Plan & Pipeline Abnormalities**: Mismatches between `SDK_EVENT_TYPES` and `billing_event_credit_weights`, duplicate feature keys, runtime enforcement gaps (62 of 102 features unenforced), and ingestion rollup bugs.
3. **Enterprise-Grade SaaS Billing Catalog Architecture (v3)**: How to build a production-grade SaaS billing catalog with **ZERO unlimited event quotas (`-1` or `"Custom"`)**, dual-layer **Generic Pooled + Per-Signal Event Quotas**, strict Free-tier hard limits, paid-tier spend caps, and complete dependency coherence.

---

## 1. Plan-by-Plan Catalog Abnormalities (All 5 Plans)

### 1.1 `free` Plan (`$0/mo` | `$0/yr`) — 8 Abnormalities

| Issue ID | Feature / Quota Key | Current Value in Catalog | Abnormality & Runtime Impact | Evidence | Recommended Fix (v3) |
|---|---|---|---|---|---|
| **FREE-01** | `quota.daily_alerts` | `10` notifications/day | Non-zero quota (`10`) configured while parent `alerting.enabled = false`. `DependencyGraph` disables this quota at runtime, making it a dead/misleading quota on the pricing matrix. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L105-L115), [`dependency-graph.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/dependency-graph.ts#L98-L132) | Set `quota.daily_alerts = 0` on `free`. |
| **FREE-02** | `quota.monthly_alerts` | `100` notifications/mo (`+$0.10/100` overage, `5%` grace) | Configured with `100` alerts/mo AND paid overage (`$0.10/100`) while `alerting.enabled = false` AND Free orgs have no Stripe payment method on file. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L110-L120) | Set `quota.monthly_alerts = 0`, `enforcement_type = "hard_limit"`, and remove overage on `free`. |
| **FREE-03** | `quota.connector_sends` | `0` sends/mo (`+$0.25/100` overage, `5%` grace) | Paid overage rate (`$0.25/100` sends) and `5%` grace (`5%` of `0 = 0`) attached to a `0` quota on the `$0` Free plan. Meanwhile `connectors.email = true` and `connectors.webhook = true` are enabled on Free, meaning enabled connectors have `0` allowed sends! | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L120-L130) | Remove overage on `free` and set `quota.connector_sends = 100` (`hard_limit`) so Free users can receive basic email/webhook notifications. |
| **FREE-04** | `quota.monthly_events` | `10,000` credits/mo (`+$0.50/1,000` overage, `10%` grace) | Paid overage (`$0.50/1,000` credits) is attached to the `$0` Free plan where no payment method exists (`provider = 'system'`), creating uncollectible overage state if overage billing is enabled. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L95-L105) | Enforce strict `hard_limit` at `10,000` credits on `free` with `overage.enabled = false`. |
| **FREE-05** | `quota.dashboards` | `1` dashboard | `quota.dashboards` declares `dependencies: ['dashboards.custom_dashboards']` in `FEATURE_REGISTRY`. On Free, `dashboards.enabled = true` (system overview dashboard), but `dashboards.custom_dashboards = false`. Consequently, `DependencyGraph` disables `quota.dashboards = 1` at runtime! | [`feature-registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/feature-registry.ts#L196-L207), [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L280-L295) | Change `quota.dashboards` dependency from `dashboards.custom_dashboards` to `dashboards.enabled`. |
| **FREE-06** | `sdk.remote_config`, `sdk.retry`, `sdk.batching`, `quota.sdk_batch_queue_size` | `false`, `false`, `false`, `0` | **Critical Runtime Bug**: [`resolveSdkEntitlementOverride()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/sdk-config/sdk-config.module.ts#L76) checks `if (!sdkRemoteConfigEnabled) throw new AppError('Remote SDK configuration is disabled...', 403, 'policy_violation')` on `POST /v1/init` and `POST /v1/sdk-config`. Because `sdk.remote_config = false` on Free, Free-tier SDKs fail initialization with HTTP `403`! Furthermore, disabling `sdk.retry` and `sdk.batching` (`queue_size = 0`) forces Free SDKs to send 1 HTTP request per event. | [`sdk-config.module.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/sdk-config/sdk-config.module.ts#L60-L82), [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L340-L355) | Enable baseline `sdk.remote_config = true`, `sdk.retry = true`, `sdk.batching = true`, and `quota.sdk_batch_queue_size = 100` on `free`. |
| **FREE-07** | `price.provider` | `'stripe'` in TS vs `'system'` in SQL | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L75-L85) sets `provider: 'stripe'` on `$0` Free prices, whereas [`004_11_billing_catalog_plans_and_prices.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/004_11_billing_catalog_plans_and_prices.sql#L56-L68) sets `provider = 'system'`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L75-L85) | Standardize to `provider = 'system'` for `free`. |
| **FREE-08** | `support.sla` | `null` | Uses `null` instead of an explicit string value (`"none"`). | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L395) | Set `support.sla = "none"`. |

---

### 1.2 `starter` Plan (`$15/mo` | `$150/yr`) — 6 Abnormalities

| Issue ID | Feature / Quota Key | Current Value in Catalog | Abnormality & Runtime Impact | Evidence | Recommended Fix (v3) |
|---|---|---|---|---|---|
| **STARTER-01** | `quota.profile_retention_days` vs `profiling.enabled` | `quota.profile_retention_days = 0` while `profiling.enabled = true` | **Critical Catalog Contradiction**: Starter enables `profiling.enabled = true`, `profiling.cpu = true`, `profiling.memory = true`, and `profiling.wall_time = true`. Starter customers can ingest profiles and are charged credits, yet `quota.profile_retention_days = 0` (`0` days retention), so `DependencyGraph` marks `quota.profile_retention_days` disabled (`effective_at_runtime = false`) and profiles have 0-day retention! | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L539-L652), [`006_11_billing_catalog_plan_entitlements.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/006_11_billing_catalog_plan_entitlements.sql) | Set `quota.profile_retention_days = 14` days on `starter`. |
| **STARTER-02** | `quota.audit_log_retention_days` | `30` days | Set to `30` days while `security.audit_logs = false` and `security.enabled = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L542) | Set `quota.audit_log_retention_days = 0` on `starter`. |
| **STARTER-03** | `quota.monthly_reports` | `5` reports/mo | Set to `5` reports/mo while `dashboards.scheduled_reports = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L565) | Set `quota.monthly_reports = 0` on `starter`. |
| **STARTER-04** | `quota.service_accounts` | `2` accounts | Set to `2` service accounts while `security.enabled = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L574) | Set `quota.service_accounts = 0` on `starter`. |
| **STARTER-05** | `quota.api_keys` | `10` keys/project | [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68) hardcodes `MAX_ACTIVE_KEYS_ON_CREATE = 5`, blocking Starter projects from creating keys 6–10. | [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68) | Enforce `quota.api_keys` from entitlements instead of hardcoded `5`. |
| **STARTER-06** | `support.sla` | `null` | Uses `null` instead of `"none"`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L825) | Set `support.sla = "none"`. |

---

### 1.3 `growth` Plan (`$49/mo` | `$490/yr`) — 7 Abnormalities

| Issue ID | Feature / Quota Key | Current Value in Catalog | Abnormality & Runtime Impact | Evidence | Recommended Fix (v3) |
|---|---|---|---|---|---|
| **GROWTH-01** | Plan key in `ObservabilityContextResolver` | Missing `"growth"` (uses `"pro"`) | [`ObservabilityContextResolver`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/observability/context.ts#L16-L23) defines `PLAN_RETENTION_DAYS = { free: 7, starter: 30, pro: 90, business: 180, enterprise: 400 }` and lacks `"growth"`. | [`context.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/observability/context.ts#L16-L23) | Replace `"pro"` with `"growth"` and query `quota.retention_days` / signal retention quotas. |
| **GROWTH-02** | `quota.audit_log_retention_days` | `180` days | Set to `180` days while `security.audit_logs = false` and `security.enabled = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L972) | Enable `security.enabled = true` and `security.audit_logs = true` on `growth` with `30` days audit retention (or set quota to `0`). |
| **GROWTH-03** | `quota.monthly_reports` | `25` reports/mo | Set to `25` reports/mo while `dashboards.scheduled_reports = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L995) | Enable `dashboards.scheduled_reports = true` on `growth` so the `25` monthly reports quota is usable. |
| **GROWTH-04** | `quota.service_accounts` | `10` accounts | Set to `10` service accounts while `security.enabled = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L1004) | Enable `security.enabled = true` on `growth` so the `10` service accounts are usable. |
| **GROWTH-05** | `quota.custom_roles` | `25` roles | Set to `25` custom roles while `security.custom_roles = false` and `security.enabled = false`. Disabled at runtime by `DependencyGraph`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L1007) | Set `quota.custom_roles = 0` on `growth` (reserve custom RBAC for `business` and `enterprise`). |
| **GROWTH-06** | `quota.api_keys` | `50` keys/project | Overridden by hardcoded `MAX_ACTIVE_KEYS_ON_CREATE = 5` in [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68). | [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68) | Enforce `quota.api_keys` from entitlements. |
| **GROWTH-07** | `support.sla` | `null` | Uses `null` instead of `"none"`. | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L1255) | Set `support.sla = "none"`. |

---

### 1.4 `business` Plan (`$149/mo` | `$1,490/yr`) — 3 Abnormalities

| Issue ID | Feature / Quota Key | Current Value in Catalog | Abnormality & Runtime Impact | Evidence | Recommended Fix (v3) |
|---|---|---|---|---|---|
| **BUSINESS-01** | `quota.custom_roles` vs `security.custom_roles` | `quota.custom_roles = 100` while `security.custom_roles = false` | Business sets `security.enabled = true` and `quota.custom_roles = 100`, but leaves `security.custom_roles = false`! Because `quota.custom_roles` depends on `security.custom_roles`, `DependencyGraph` disables all `100` custom roles on Business at runtime! | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L1437-L1695), [`dependency-graph.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/dependency-graph.ts#L98-L132) | Enable `security.custom_roles = true` on `business` (with `quota.custom_roles = 25` or `100`). |
| **BUSINESS-02** | Default Organization Provisioning (`DEFAULT_PLAN_KEY`) | `'business'` (14-day trial) -> `'paused'` on expiry | [`BillingProvisioningRepository`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/provisioning/repository.ts#L39) provisions every new signup onto a 14-day trial of `business`. When the trial expires without a payment method, [`BillingJobsRepository.expireTrials()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/jobs/repository.ts#L324) sets `status = 'paused'` (blocking ingestion) rather than downgrading to `free`. | [`provisioning/repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/provisioning/repository.ts#L39), [`jobs/repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/jobs/repository.ts#L324) | Auto-downgrade expired trials to `free` (or provision `free` by default with opt-in trials). |
| **BUSINESS-03** | `quota.api_keys` | `250` keys/project | Overridden by hardcoded `MAX_ACTIVE_KEYS_ON_CREATE = 5` in [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68). | [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68) | Enforce `quota.api_keys` from entitlements. |

---

### 1.5 `enterprise` Plan (`Custom` / Finite Baseline) — 4 Abnormalities

| Issue ID | Feature / Quota Key | Current Value in Catalog | Abnormality & Runtime Impact | Evidence | Recommended Fix (v3) |
|---|---|---|---|---|---|
| **ENTERPRISE-01** | `quota.monthly_events` | `"Custom"` in TS (`integer_value = NULL` in SQL) or `-1` (unlimited) | **Critical Bug & SaaS Anti-Pattern**:<br>1. In [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L2152), `quota.monthly_events` is `"Custom"` (a string on an `integer` feature), causing [`BillingCatalogValidator`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/catalog-validator.ts#L86-L106) to fail with `INVALID_INTEGER_VALUE`.<br>2. In [`006_11_billing_catalog_plan_entitlements.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/006_11_billing_catalog_plan_entitlements.sql), `integer_value` is `NULL` (`is_unlimited = TRUE`), and [`EntitlementsService.getEffectiveIntegerFeature()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/service.ts#L106-L115) returns `row?.integer_value ?? 0` = **`0`**, blocking Enterprise event ingestion!<br>3. Using `-1` (unlimited) is a dangerous SaaS anti-pattern: a runaway SDK loop on an Enterprise account can ingest billions of events with zero guardrails, and `-1` corrupts additive addon math in [`EFFECTIVE_ENTITLEMENTS_SQL`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/repository.ts#L80) (`-1 + 100000 = 99999`). | [`plan-matrix.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/catalog/plan-matrix.ts#L2152), [`entitlements/service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/service.ts#L106-L115), [`entitlements/repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/repository.ts#L80) | Eliminate `-1` and `"Custom"`. Set a concrete **finite numeric baseline** of **`50,000,000` monthly event credits** (`is_unlimited: false`, `supports_unlimited: false`), plus finite per-signal event quotas. Apply custom contract volumes via `organization_entitlement_overrides` or stackable add-ons. |
| **ENTERPRISE-02** | `quota.retention_days` | `365` in catalog vs `400` in `ObservabilityContextResolver` | [`ObservabilityContextResolver`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/observability/context.ts#L21) hardcodes `enterprise: 400` days instead of the catalog's `365` days. | [`context.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/observability/context.ts#L21) | Align `ObservabilityContextResolver` with catalog `365` days. |
| **ENTERPRISE-03** | Duplicate Seeder `032_17` | `trial_days = 0, is_public = true, sort_order = 50` | [`032_17_enterprise_ingestion_004_plans_seed.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/032_17_enterprise_ingestion_004_plans_seed.sql) conflicts with [`004_11_billing_catalog_plans_and_prices.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/004_11_billing_catalog_plans_and_prices.sql) (`trial_days = 30, is_public = false, sort_order = 5`). | [`032_17_enterprise_ingestion_004_plans_seed.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/032_17_enterprise_ingestion_004_plans_seed.sql) | Remove obsolete `032_17` seeder. |
| **ENTERPRISE-04** | `quota.api_keys` | `1,000` keys/project | Overridden by hardcoded `MAX_ACTIVE_KEYS_ON_CREATE = 5` in [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68). | [`api-key.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.service.ts#L67-L68) | Enforce `quota.api_keys` from entitlements. |

---

## 2. Structural & Runtime Pipeline Abnormalities

### 2.1 `SDK_EVENT_TYPES` vs `billing_event_credit_weights` Mismatch
* [`SDK_EVENT_TYPES`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/normalizers/event-normalizer.ts#L37-L40) defines the 10 telemetry event types accepted by the ingestion pipeline:
  `error`, `message`, `request`, `span`, `trace`, `metric`, `log`, `profile`, `cron_checkin`, `replay`.
* [`007_11_billing_event_credit_weights.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/20_seeders/007_11_billing_event_credit_weights.sql) defines weights for:
  `error` (`1.0`), `crash` (`2.0`), `log` (`0.2`), `metric` (`0.1`), `span` (`0.15`), `trace` (`1.0`), `replay` (`5.0`), `session` (`1.0`), `ai_action` (`10.0`), `alert_delivery` (`0.25`).
* **Abnormalities**:
  1. **4 ingested SDK event types are missing from `billing_event_credit_weights`**: `request`, `profile`, `cron_checkin`, and `message`. Because [`IngestionRepository.getCreditWeights()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/repository.ts#L291-L320) falls back to `1.0` when an event type is missing, every HTTP `request` event and every `cron_checkin` is charged `1.0` full credit (10x the cost of a metric and 6.6x the cost of a span!), while CPU/heap `profile` payloads are under-weighted at `1.0` instead of `2.0`.
  2. **`ai_action` (`10.0`) double-charges AI**: AI investigations already have their own dedicated quota (`quota.ai_credits`) and per-mode credit rules (`credit_rules` in `033_18_ai_004_credit_rules.sql`).

### 2.2 `UsageRollupWorker` Fractional Credit Cast Bug & Staging Table Race
* **Bigint Cast Crash on Fractional Credits**: In [`src/modules/ingestion/workers/usage-rollup.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/workers/usage-rollup.ts#L98-L276), `UsageRollup.run()` sums weighted credits (`s.total`, which is a float such as `0.2` for a log or `0.15` for a span) and passes `s.total` into `BULK_DAILY_UPSERT_SQL` / `BULK_HOURLY_UPSERT_SQL` bound to `$3::bigint[]` (`events_count`). PostgreSQL rejects decimal strings (`"0.2"`) in `bigint[]`, throwing `invalid input syntax for type bigint: "0.2"`!
* **Staging Table Race Condition**: In [`001_functions.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/17_functions/001_functions.sql#L286), `flush_usage_counters()` selects and deletes from `usage_counter_staging` **without** `AND counter_type NOT LIKE 'billing:%'`, competing with `UsageRollup.processBillingFlush()`.

### 2.3 Duplicate Feature Keys in `FEATURE_REGISTRY`
1. `quota.alert_channels` vs `quota.notification_channels`: Both have identical limits (`0, 10, 50, 250, 1000`), scope (`organization`), and dependencies (`alerting.enabled`). [`alerting.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/service.ts#L852) checks `quota.alert_channels`, whereas [`quotas.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/quotas/quotas.service.ts#L101) checks `quota.notification_channels`.
2. `quota.connectors` vs `quota.integrations`: Both have identical limits (`2, 10, 50, 250, 1000`), scope (`organization`), and dependencies (`connectors.enabled`).
3. `quota.retention_days` vs `quota.log_retention_days` / `quota.metric_retention_days` / `quota.trace_retention_days`: Identical across all 5 plans (`7, 30, 90, 180, 365`), while `quota.error_retention_days` is missing.

### 2.4 62 of 102 Features Have Zero Runtime Enforcement
* **Ingestion Signal Gateways**: [`IngestionService`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/service.ts#L314-L530) only checks `ingestion.enabled` and `quota.monthly_events`. It **never** checks `error_tracking.enabled`, `logging.enabled`, `metrics.enabled`, `tracing.enabled`, `profiling.enabled`, `replay.enabled`, `cron_monitoring.enabled`, or `quota.requests_per_second`!
* **SQL SDK Builder**: [`pulse_build_sdk_config()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/primarydbv2/schema/17_functions/001_functions.sql#L605-L618) hardcodes `'profiling', false, 'sessionReplay', false, 'crons', false` for all plans.
* **Automation Legacy v1 Keys**: [`src/modules/automation/entitlements.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/automation/entitlements.ts#L16-L64) checks `module_automation_enabled` (legacy v1 naming) instead of `automation.enabled`, causing all automation entitlement checks to fail-closed to `false`, and [`src/modules/automation/repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/automation/repository.ts#L781) checks `quota.alert_rules` instead of `quota.automation_rules`.

---

## 3. How to Build an Enterprise-Grade SaaS Billing Catalog (v3 Architecture)

To make Pulsiv's billing catalog truly **Enterprise-Grade**, we established 6 architectural rules in [`docs/billing/billing-plans.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-plans.json) and [`docs/billing/billing-enterprise-catalog-v3.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-enterprise-catalog-v3.json):

### Rule 1: Zero Unlimited Event or Resource Quotas (`supports_unlimited = false`, `is_unlimited = false`)
* **Never use `-1` or `"Custom"` for any quota in the catalog.**
* Every plan—including `enterprise`—has a **concrete, finite numeric baseline** (`50,000,000` monthly event credits on Enterprise).
* When an Enterprise customer negotiates a higher commitment (e.g., `250,000,000` credits/month), that custom limit is written as a finite integer in `organization_entitlement_overrides` or via stackable `subscription_addons` (`extra_events_100k`).
* **Benefits**:
  1. Protects SaaS COGS and multi-tenant ingestion infrastructure from unbounded runaway traffic.
  2. Eliminates the `-1 + addon` SQL bug in `EFFECTIVE_ENTITLEMENTS_SQL` because every base quota and every addon is a positive finite integer.
  3. Eliminates the `NULL -> 0` bug in `EntitlementsService.getEffectiveIntegerFeature()`.

### Rule 2: Dual-Layer Telemetry Quotas (Generic Pooled Credit Budget + Generic Per-Signal Event Quotas)
Relying solely on a single pooled `quota.monthly_events` budget allows a sudden spike in verbose debug logs or session replays (`5.0` credits each) to exhaust 100% of an organization's monthly budget and drop mission-critical **errors** and **cron/uptime check-ins**.

An enterprise-grade observability billing catalog enforces **two layers of finite event quotas**:
1. **Layer 1 — Generic Pooled Monthly Telemetry Credit Quota (`quota.monthly_events`)**:
   Total weighted credit pool across all signals (`10,000` Free -> `150,000` Starter -> `1,000,000` Growth -> `8,000,000` Business -> `50,000,000` Enterprise).
2. **Layer 2 — Generic Per-Signal Monthly Event Quotas**:
   Every telemetry signal family has its own explicit, finite monthly event cap so noisy signals are isolated from critical signals:

| Generic Signal Quota Key | SDK Event Types | Unit | Free (`$0`) | Starter (`$15`) | Growth (`$49`) | Business (`$149`) | Enterprise (Baseline) |
|---|---|---|---:|---:|---:|---:|---:|
| **`quota.monthly_events`** *(Pooled Credits)* | All 10 SDK event types | `credits` | `10,000` | `150,000` | `1,000,000` | `8,000,000` | `50,000,000` |
| **`quota.monthly_error_events`** | `error`, `message` | `events` | `5,000` | `50,000` | `250,000` | `2,000,000` | `15,000,000` |
| **`quota.monthly_log_events`** | `log` | `events` | `25,000` | `500,000` | `3,000,000` | `25,000,000` | `150,000,000` |
| **`quota.monthly_metric_data_points`** | `metric` | `data_points` | `50,000` | `1,000,000` | `5,000,000` | `40,000,000` | `250,000,000` |
| **`quota.monthly_trace_spans`** | `trace`, `span` | `spans` | `10,000` | `200,000` | `1,500,000` | `10,000,000` | `60,000,000` |
| **`quota.monthly_request_events`** | `request` | `requests` | `25,000` | `300,000` | `2,000,000` | `15,000,000` | `100,000,000` |
| **`quota.monthly_replay_sessions`** | `replay` | `replays` | `0` | `2,500` | `15,000` | `100,000` | `1,000,000` |
| **`quota.monthly_profiles`** | `profile` | `profiles` | `0` | `5,000` | `50,000` | `500,000` | `5,000,000` |
| **`quota.monthly_cron_checkins`** | `cron_checkin` | `checkins` | `0` | `50,000` | `250,000` | `1,000,000` | `10,000,000` |

### Rule 3: 1:1 Alignment Between `SDK_EVENT_TYPES` and Credit Weights
Every `SDK_EVENT_TYPES` value has an explicit weight in the v3 catalog:
* `error`: `1.0` credit (`quota.monthly_error_events`)
* `message`: `0.5` credits (`quota.monthly_error_events`)
* `request`: `0.25` credits (`quota.monthly_request_events`)
* `trace`: `1.0` credit (`quota.monthly_trace_spans`)
* `span`: `0.15` credits (`quota.monthly_trace_spans`)
* `log`: `0.2` credits (`quota.monthly_log_events`)
* `metric`: `0.1` credits (`quota.monthly_metric_data_points`)
* `profile`: `2.0` credits (`quota.monthly_profiles`)
* `cron_checkin`: `0.2` credits (`quota.monthly_cron_checkins`)
* `replay`: `5.0` credits (`quota.monthly_replay_sessions`)

### Rule 4: Tiered Enforcement Policy (Free Hard Limit vs Paid Metered Overage with Spend Cap)
* **`free` Plan**: Uses `enforcement_type: "hard_limit"` across 100% of quotas with **zero overage rates**. Free accounts never accumulate unbillable overage charges.
* **`starter`, `growth`, `business`, `enterprise` Plans**: Support `metered_overage_with_spend_cap` on `quota.monthly_events`, `quota.monthly_alerts`, and `quota.connector_sends`, with volume-tiered overage discounting (`$0.50/1k` Starter -> `$0.40/1k` Growth -> `$0.30/1k` Business -> `$0.20/1k` Enterprise) and organization-configurable monthly overage spend caps (`max_overage_spend_minor`).

### Rule 5: 100% Dependency Graph Coherence
* Every enabled feature (`true`) has positive (`> 0`) supporting quotas (e.g., `starter` `profiling.enabled = true` -> `quota.profile_retention_days = 14`, `quota.monthly_profiles = 5,000`; `business` `security.custom_roles = true` -> `quota.custom_roles = 25`).
* Every disabled feature (`false`) has `0` for its dependent quotas (e.g., `free` `alerting.enabled = false` -> `quota.daily_alerts = 0`, `quota.monthly_alerts = 0`; `starter` `security.audit_logs = false` -> `quota.audit_log_retention_days = 0`).

---

## 4. Complete Suite of Generated Canonical JSON Files in `docs/billing/`

| File | Size | Purpose |
|---|---:|---|
| [`docs/billing/billing-plans.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-plans.json) | `787 KB` | Master canonical billing catalog with all 5 plans, finite `50,000,000` Enterprise event credit baseline (zero `-1` unlimited), 8 `generic_signal_event_quotas` per plan, `catalog_anomalies_and_issues` per plan, 102 features, credit weights, AI rules, add-ons, coupons, and tax configs. |
| [`docs/billing/billing-enterprise-catalog-v3.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-enterprise-catalog-v3.json) | `33 KB` | Clean Enterprise-Grade v3 catalog specification resolving all 24 plan anomalies, defining the dual-layer pooled + per-signal event quotas, 1:1 `SDK_EVENT_TYPES` credit weights, and zero-unlimited finite quotas across all 5 plans. |
| [`docs/billing/billing-features-catalog.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-features-catalog.json) | `501 KB` | All 102 features with `supports_unlimited: false`, finite values across all plans, dependency chains, and runtime consumer mappings. |
| [`docs/billing/billing-entitlement-matrix.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-entitlement-matrix.json) | `530 KB` | Complete 5x102 (`510` cells) entitlement matrix in both API preview format and normalized SQL format with zero `is_unlimited: true` rows. |
| [`docs/billing/billing-credits-and-metering.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-credits-and-metering.json) | `41 KB` | Telemetry credit weights, generic per-signal event quotas by plan, AI credit rules, AI model routes, overage rules (excluding `free`), and usage threshold alert policies. |
| [`docs/billing/billing-addons-and-promotions.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-addons-and-promotions.json) | `11 KB` | Capacity add-ons (`extra_events_100k`, `extra_ai_credits_500`, `extra_project`, `extra_member`), coupon templates, tax rules, and SDK plan defaults. |
| [`docs/billing/billing-catalog-audit.json`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/billing/billing-catalog-audit.json) | `28 KB` | Machine-readable audit report containing `plan_by_plan_anomalies` for all 5 plans and all 21 verified catalog/runtime conflicts (`CONFLICT-01` through `CONFLICT-21`). |
