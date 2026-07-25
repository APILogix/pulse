# MODULE KNOWLEDGE BASE: BILLING

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/billing`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **billing** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 9
- **Services:** 11
- **Repositories:** 11
- **Discovered Routes:** 27
- **Owned Database Tables:** billing_webhook_events, billing_audit_logs, billing_features
- **External Integrations:** Stripe, Razorpay

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/billing/
├── controller.ts
├── repository.ts
├── routes.ts
├── schemas.ts
├── service.ts
├── billing.module.ts
├── controller.ts
├── repository.ts
├── routes.ts
├── schemas.ts
├── service.ts
├── controller.ts
├── repository.ts
├── routes.ts
├── schemas.ts
├── service.ts
├── controller.ts
├── repository.ts
├── routes.ts
├── schemas.ts
├── service.ts
├── addon-expiration.job.ts
├── ai-credit-reset.job.ts
├── billing-audit-archive.job.ts
├── billing-metrics.job.ts
├── config.ts
├── coupon-expiration.job.ts
├── data-reconciliation.job.ts
├── definitions.ts
├── entitlement-refresh.job.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `POST` | `/consume` | ❌ No | Global | `src/modules/billing/ai/routes.ts` | Standard (60/min) |
| `GET` | `/validate` | ❌ No | Global | `src/modules/billing/coupons/routes.ts` | Standard (60/min) |
| `POST` | `/apply` | ❌ No | Global | `src/modules/billing/coupons/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/billing/entitlements/routes.ts` | Standard (60/min) |
| `POST` | `/check` | ❌ No | Global | `src/modules/billing/entitlements/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/billing/invoices/routes.ts` | Standard (60/min) |
| `GET` | `/upcoming` | ❌ No | Global | `src/modules/billing/invoices/routes.ts` | Standard (60/min) |
| `GET` | `/:invoiceId` | ❌ No | Global | `src/modules/billing/invoices/routes.ts` | Standard (60/min) |
| `POST` | `/:invoiceId/pay` | ❌ No | Global | `src/modules/billing/invoices/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/billing/payments/routes.ts` | Standard (60/min) |
| `GET` | `/` | ✅ Yes | Global | `src/modules/billing/plans/routes.ts` | Standard (60/min) |
| `GET` | `/public` | ❌ No | Global | `src/modules/billing/plans/routes.ts` | Standard (60/min) |
| `GET` | `/compare` | ✅ Yes | Global | `src/modules/billing/plans/routes.ts` | Standard (60/min) |
| `GET` | `/:planId` | ✅ Yes | Global | `src/modules/billing/plans/routes.ts` | Standard (60/min) |
| `POST` | `/estimate` | ✅ Yes | Global | `src/modules/billing/plans/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `GET` | `/history` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `POST` | `/` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `POST` | `/change-plan` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `POST` | `/upgrade` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `POST` | `/downgrade` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `POST` | `/cancel` | ❌ No | Global | `src/modules/billing/subscriptions/routes.ts` | Standard (60/min) |
| `GET` | `/current` | ❌ No | Global | `src/modules/billing/usage/routes.ts` | Standard (60/min) |
| `GET` | `/daily` | ❌ No | Global | `src/modules/billing/usage/routes.ts` | Standard (60/min) |
| `POST` | `/increment-events` | ❌ No | Global | `src/modules/billing/usage/routes.ts` | Standard (60/min) |
| `POST` | `/stripe` | ❌ No | Global | `src/modules/billing/webhooks/routes.ts` | Standard (60/min) |
| `POST` | `/razorpay` | ❌ No | Global | `src/modules/billing/webhooks/routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (POST /consume)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] AiBillingController
  ↓
[Service] AiBillingService
  ↓
[Repository] AiBillingRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### AiBillingService
- **Source File:** `src/modules/billing/ai/service.ts`
- **Methods:** `consumeAiCredits()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/ai/repository").AiBillingRepository
- **External Calls:** None


### CouponsService
- **Source File:** `src/modules/billing/coupons/service.ts`
- **Methods:** `validateCoupon()`, `applyCoupon()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/coupons/repository").CouponsRepository
- **External Calls:** None


### EntitlementsService
- **Source File:** `src/modules/billing/entitlements/service.ts`
- **Methods:** `getAllEntitlements()`, `checkFeatureAccess()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/repository").EntitlementsRepository
- **External Calls:** None


### InvoicesService
- **Source File:** `src/modules/billing/invoices/service.ts`
- **Methods:** `listInvoices()`, `getInvoice()`, `getUpcomingInvoice()`, `payInvoice()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/invoices/repository").InvoicesRepository
- **External Calls:** None


### BillingJobsService
- **Source File:** `src/modules/billing/jobs/service.ts`
- **Methods:** `runSubscriptionRenewal()`, `runTrialExpiration()`, `runInvoiceGeneration()`, `runPaymentSync()`, `runPaymentReconciliation()`, `runWebhookRetry()`, `runWebhookDeadLetter()`, `runUsageRollover()`, `runUsageAggregation()`, `runAiCreditReset()`, `runCouponExpiration()`, `runAddonExpiration()`, `runFeatureOverrideExpiration()`, `runInvoiceReminder()`, `runPartitionCreator()`, `runPartitionCleanup()`, `runUsageAnomaly()`, `runEntitlementRefresh()`, `runBillingAuditArchive()`, `runDataReconciliation()`, `runBillingMetrics()`, `run()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/jobs/repository").BillingJobsRepository
- **External Calls:** None


### PaymentsService
- **Source File:** `src/modules/billing/payments/service.ts`
- **Methods:** `listPayments()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/payments/repository").PaymentsRepository
- **External Calls:** None


### PlansService
- **Source File:** `src/modules/billing/plans/service.ts`
- **Methods:** `listPlans()`, `getPlan()`, `estimatePricing()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/plans/repository").PlansRepository
- **External Calls:** None


### BillingProvisioningService
- **Source File:** `src/modules/billing/provisioning/service.ts`
- **Methods:** `provisionFreeSubscription()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/provisioning/repository").BillingProvisioningRepository
- **External Calls:** None


### SubscriptionsService
- **Source File:** `src/modules/billing/subscriptions/service.ts`
- **Methods:** `getSubscription()`, `getHistory()`, `createSubscription()`, `changePlan()`, `cancelSubscription()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/subscriptions/repository").SubscriptionsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/plans/repository").PlansRepository
- **External Calls:** None


### UsageService
- **Source File:** `src/modules/billing/usage/service.ts`
- **Methods:** `getCurrentUsage()`, `incrementEventUsage()`, `getDailyUsage()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/usage/repository").UsageRepository
- **External Calls:** None


### WebhooksService
- **Source File:** `src/modules/billing/webhooks/service.ts`
- **Methods:** `processWebhook()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/webhooks/repository").WebhooksRepository
- **External Calls:** None


---

## 5. Repositories & Database Operations


### AiBillingRepository
- **Source File:** `src/modules/billing/ai/repository.ts`
- **Methods:** `withTransaction()`, `logAiUsage()`, `consumeAiCredits()`, `hasSufficientAiCredits()`
- **Tables Touched:** `ai_usage_logs`
- **Transactions:** ✅ Uses Database Transactions


### CouponsRepository
- **Source File:** `src/modules/billing/coupons/repository.ts`
- **Methods:** `withTransaction()`, `getCouponByCode()`, `getCouponByCodeForUpdate()`, `isCouponApplicableToPlan()`, `getOrgRedemptionCount()`, `redeemCoupon()`
- **Tables Touched:** `coupons`, `coupon_redemptions`, `coupon_applicable_plans`
- **Transactions:** ✅ Uses Database Transactions


### EntitlementsRepository
- **Source File:** `src/modules/billing/entitlements/repository.ts`
- **Methods:** `getEffectiveEntitlements()`, `hasFeature()`, `getEffectiveIntegerFeature()`
- **Tables Touched:** None
- **Transactions:** ❌ Simple Queries Only


### InvoicesRepository
- **Source File:** `src/modules/billing/invoices/repository.ts`
- **Methods:** `listInvoices()`, `getInvoiceById()`
- **Tables Touched:** `invoices`
- **Transactions:** ❌ Simple Queries Only


### BillingJobsRepository
- **Source File:** `src/modules/billing/jobs/repository.ts`
- **Methods:** `withTransaction()`, `renewSubscriptions()`, `expireTrials()`, `generateInvoices()`, `syncPayments()`, `reconcilePayments()`, `retryWebhooks()`, `deadLetterWebhooks()`, `rollOverUsage()`, `aggregateUsage()`, `resetAiCredits()`, `expireCoupons()`, `expireAddons()`, `expireFeatureOverrides()`, `markInvoiceReminders()`, `createPartitions()`, `cleanupPartitions()`, `detectUsageAnomalies()`, `refreshEntitlements()`, `archiveAuditLogs()`, `reconcileData()`, `publishMetrics()`, `updateWithAudit()`
- **Tables Touched:** `plan_prices`, `organization_subscriptions`, `subscription_events`, `subscription_addons`, `organization_feature_overrides`, `organization_usage_current_period`, `usage_daily_counters`, `ai_usage_logs`, `invoices`, `payments`, `billing_webhook_events`, `coupons`, `coupon_redemptions`, `billing_audit_logs`
- **Transactions:** ✅ Uses Database Transactions


### PaymentsRepository
- **Source File:** `src/modules/billing/payments/repository.ts`
- **Methods:** `listPayments()`
- **Tables Touched:** `payments`
- **Transactions:** ❌ Simple Queries Only


### PlansRepository
- **Source File:** `src/modules/billing/plans/repository.ts`
- **Methods:** `listActivePlans()`, `getPlanById()`, `getPlanPrices()`, `getPlanEntitlements()`, `getAllActivePlanPrices()`
- **Tables Touched:** `plans`, `plan_prices`, `billing_features`, `plan_feature_entitlements`
- **Transactions:** ❌ Simple Queries Only


### BillingProvisioningRepository
- **Source File:** `src/modules/billing/provisioning/repository.ts`
- **Methods:** `provisionFreeSubscription()`
- **Tables Touched:** `plans`, `billing_features`, `plan_feature_entitlements`, `organization_subscriptions`, `subscription_events`, `organization_usage_current_period`, `errors`
- **Transactions:** ✅ Uses Database Transactions


### SubscriptionsRepository
- **Source File:** `src/modules/billing/subscriptions/repository.ts`
- **Methods:** `withTransaction()`, `getActiveSubscription()`, `getSubscriptionForUpdate()`, `createSubscription()`, `updateSubscription()`, `logEvent()`, `getSubscriptionHistory()`
- **Tables Touched:** `organization_subscriptions`, `subscription_events`
- **Transactions:** ✅ Uses Database Transactions


### UsageRepository
- **Source File:** `src/modules/billing/usage/repository.ts`
- **Methods:** `getCurrentUsage()`, `incrementEventUsage()`, `getDailyUsageRecords()`
- **Tables Touched:** `usage_daily_counters`
- **Transactions:** ❌ Simple Queries Only


### WebhooksRepository
- **Source File:** `src/modules/billing/webhooks/repository.ts`
- **Methods:** `insertWebhookEvent()`
- **Tables Touched:** `billing_webhook_events`
- **Transactions:** ❌ Simple Queries Only


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `ai_usage_logs` | Reader/Writer | 28 | 0 | 0 |
| `coupons` | Reader/Writer | 24 | 5 | 3 |
| `coupon_redemptions` | Reader/Writer | 24 | 6 | 1 |
| `coupon_applicable_plans` | Reader/Writer | 7 | 2 | 0 |
| `invoices` | Reader/Writer | 32 | 7 | 2 |
| `plan_prices` | Reader/Writer | 28 | 8 | 2 |
| `organization_subscriptions` | Reader/Writer | 25 | 6 | 2 |
| `subscription_events` | Reader/Writer | 22 | 6 | 0 |
| `subscription_addons` | Reader/Writer | 19 | 5 | 1 |
| `organization_feature_overrides` | Reader/Writer | 29 | 5 | 2 |
| `organization_usage_current_period` | Reader/Writer | 36 | 5 | 2 |
| `usage_daily_counters` | Reader/Writer | 27 | 0 | 1 |
| `payments` | Reader/Writer | 33 | 6 | 1 |
| `billing_webhook_events` | Owner | 25 | 7 | 1 |
| `billing_audit_logs` | Owner | 32 | 0 | 0 |
| `plans` | Reader/Writer | 12 | 5 | 1 |
| `billing_features` | Owner | 14 | 3 | 1 |
| `plan_feature_entitlements` | Reader/Writer | 20 | 3 | 2 |
| `errors` | Reader/Writer | 19 | 4 | 0 |


---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** None
- **Queue Jobs:** None

---

## 8. Enterprise Health Scorecard

| Domain | Score | Rating | Analysis |
|---|---|---|---|
| **Architecture** | 85/100 | Great | Bounded context isolation |
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `billing` implement strict rate limiting.
- **P2:** Expand unit test coverage for `AiBillingService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.
