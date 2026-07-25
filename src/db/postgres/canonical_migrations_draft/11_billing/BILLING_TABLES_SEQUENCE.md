# PostgreSQL Billing Database Tables Sequence

This document provides a sequential reference of all database types, tables, partitions, views, and functions under the PostgreSQL billing module (`pulse/src/db/postgres/canonical_migrations_draft/11_billing`).

---

## Migration Sequence Overview

| Seq | Migration File | Object Name | Object Type | Description |
|---|---|---|---|---|
| 01 | `001_billing_enums.sql` | *Multiple ENUMs* | Custom Types | Defines 11 billing ENUM types |
| 02 | `002_plans.sql` | `plans` | Base Table | Master plan definitions & commercial tiers |
| 03 | `003_plan_prices.sql` | `plan_prices` | Base Table | Multi-currency, multi-provider plan pricing |
| 04 | `004_billing_features.sql` | `billing_features` | Base Table | Catalog of billable features & quota limits |
| 05 | `005_plan_feature_entitlements.sql` | `plan_feature_entitlements` | Base Table | Feature values & entitlement rules per plan |
| 06 | `006_organization_subscriptions.sql` | `organization_subscriptions` | Base Table | Active & historical organization subscriptions |
| 07 | `007_subscription_events.sql` | `subscription_events` | Ledger Table | Immutable log of subscription state transitions |
| 08 | `008_subscription_addons.sql` | `subscription_addons` | Base Table | Purchased add-on capacity and features |
| 09 | `009_organization_feature_overrides.sql` | `organization_feature_overrides` | Base Table | Custom per-organization entitlement overrides |
| 10 | `010_organization_usage_current_period.sql` | `organization_usage_current_period` | Fast-path Table | Real-time usage counters for quota checks |
| 11 | `011_usage_daily_counters.sql` | `usage_daily_counters` | Partition Parent | Historical daily usage counters (by date) |
| 11a | `011_usage_daily_counters.sql` | `usage_daily_counters_2026_07` | Range Partition | Monthly partition for July 2026 |
| 12 | `012_ai_usage_logs.sql` | `ai_usage_logs` | Partition Parent | Immutable AI feature consumption ledger |
| 12a | `012_ai_usage_logs.sql` | `ai_usage_logs_2026_07` | Range Partition | Monthly partition for July 2026 |
| 13 | `013_invoices.sql` | `invoices` | Base Table | Generated subscription & overage invoices |
| 14 | `014_payments.sql` | `payments` | Base Table | Transaction ledger for payments & refunds |
| 15 | `015_billing_webhook_events.sql` | `billing_webhook_events` | Inbox Table | Webhook inbox store for Stripe / Razorpay |
| 16 | `016_coupons.sql` | `coupons` | Base Table | Promotional discount & coupon definitions |
| 17 | `017_coupon_redemptions.sql` | `coupon_redemptions` | Base Table | History of redeemed coupons |
| 18 | `018_coupon_applicable_plans.sql` | `coupon_applicable_plans` | Junction Table | Maps coupons to applicable billing plans |
| 19 | `019_billing_audit_logs.sql` | `billing_audit_logs` | Partition Parent | Immutable append-only billing audit trail |
| 19a | `019_billing_audit_logs.sql` | `billing_audit_logs_2026_07` | Range Partition | Monthly partition for July 2026 |
| 20 | `020_views_and_functions.sql` | `v_effective_entitlements` | View | Resolved active entitlements per org |
| 20a | `020_views_and_functions.sql` | `v_current_usage` | View | Current period quota vs usage summary |
| 20b | `020_views_and_functions.sql` | `v_subscription_summary` | View | High-level subscription & plan overview |

---

## Detailed Table & Object Definitions (In Order)

### 01. `001_billing_enums.sql` - Custom PostgreSQL Types
- **`billing_plan_tier`**: `'free'`, `'starter'`, `'growth'`, `'business'`, `'enterprise'`
- **`billing_subscription_status`**: `'trialing'`, `'active'`, `'past_due'`, `'paused'`, `'cancelled'`, `'expired'`, `'incomplete'`
- **`billing_provider_type`**: `'stripe'`, `'razorpay'`, `'manual'`, `'system'`
- **`billing_interval_type`**: `'monthly'`, `'annual'`
- **`billing_invoice_status`**: `'draft'`, `'open'`, `'paid'`, `'void'`, `'uncollectible'`, `'refunded'`
- **`billing_payment_status`**: `'pending'`, `'processing'`, `'succeeded'`, `'failed'`, `'cancelled'`, `'refunded'`
- **`billing_coupon_discount_type`**: `'percentage'`, `'fixed_amount'`
- **`billing_feature_value_type`**: `'boolean'`, `'integer'`, `'decimal'`, `'string'`
- **`billing_feature_category`**: `'monitoring'`, `'ai'`, `'alerts'`, `'projects'`, `'organization'`, `'dashboard'`, `'security'`, `'limits'`, `'integrations'`
- **`subscription_event_type`**: `'created'`, `'upgraded'`, `'downgraded'`, `'renewed'`, `'trial_started'`, `'trial_ended'`, `'cancelled'`, `'resumed'`, `'expired'`, `'payment_failed'`, `'payment_succeeded'`, `'addon_purchased'`, `'feature_override_added'`
- **`subscription_event_actor`**: `'user'`, `'admin'`, `'system'`, `'billing_provider'`

---

### 02. `002_plans.sql` - Table: `plans`
Commercial plan definitions and tier metadata.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Unique plan ID |
| `key` | VARCHAR(50) | NOT NULL | Machine-readable identifier (e.g. starter) |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | Plan definition version |
| `name` | VARCHAR(100) | NOT NULL | Human-readable name |
| `tier` | billing_plan_tier | NOT NULL | Commercial tier |
| `description` | TEXT | NULLABLE | Description |
| `trial_days` | INTEGER | NOT NULL, DEFAULT 0, CHECK (>=0) | Trial duration in days |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Assignable flag |
| `is_public` | BOOLEAN | NOT NULL, DEFAULT TRUE | Public listing flag |
| `sort_order` | INTEGER | NOT NULL, DEFAULT 0 | UI ordering |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 03. `003_plan_prices.sql` - Table: `plan_prices`
Pricing for plans supporting multiple currencies, intervals, and payment providers.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Unique price ID |
| `plan_id` | UUID | NOT NULL, FK → `plans(id)` ON DELETE CASCADE | Target plan |
| `provider` | billing_provider_type | NOT NULL | Billing provider (Stripe, Razorpay, etc.) |
| `billing_interval` | billing_interval_type | NOT NULL | `monthly` or `annual` |
| `currency` | CHAR(3) | NOT NULL | ISO Currency Code (USD, INR, EUR) |
| `amount_minor` | BIGINT | NOT NULL, CHECK (>=0) | Amount in smallest currency unit (cents/paise) |
| `provider_price_id` | VARCHAR(150) | NULLABLE | Provider reference (e.g. price_1N...) |
| `is_default` | BOOLEAN | NOT NULL, DEFAULT FALSE | Default price for interval/currency |
| `starts_at` | TIMESTAMPTZ | NULLABLE | Price activation start |
| `ends_at` | TIMESTAMPTZ | NULLABLE | Price activation end |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Provider-specific metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 04. `004_billing_features.sql` - Table: `billing_features`
Master catalog of billable platform capabilities and feature flags.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Unique feature ID |
| `feature_key` | VARCHAR(100) | NOT NULL, UNIQUE | Stable code key (e.g. `monthly_events`) |
| `feature_name` | VARCHAR(150) | NOT NULL | Display name |
| `description` | TEXT | NULLABLE | Detailed feature description |
| `category` | billing_feature_category | NOT NULL | Category classification |
| `value_type` | billing_feature_value_type | NOT NULL | Value data type (`boolean`, `integer`, etc.) |
| `is_billable` | BOOLEAN | NOT NULL, DEFAULT TRUE | Billable capability flag |
| `is_public` | BOOLEAN | NOT NULL, DEFAULT TRUE | Public visibility flag |
| `is_deprecated` | BOOLEAN | NOT NULL, DEFAULT FALSE | Deprecation status |
| `sort_order` | INTEGER | NOT NULL, DEFAULT 0 | UI sorting index |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 05. `005_plan_feature_entitlements.sql` - Table: `plan_feature_entitlements`
Maps billing plans to feature entitlements and quota limits.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Entitlement ID |
| `plan_id` | UUID | NOT NULL, FK → `plans(id)` ON DELETE CASCADE | Associated plan |
| `feature_id` | UUID | NOT NULL, FK → `billing_features(id)` ON DELETE CASCADE | Target feature |
| `boolean_value` | BOOLEAN | NULLABLE | Value if boolean feature |
| `integer_value` | BIGINT | NULLABLE | Quota limit if integer feature (-1 = unlimited) |
| `decimal_value` | NUMERIC(20,6) | NULLABLE | Numerical quota if decimal |
| `string_value` | TEXT | NULLABLE | String tier/option |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 06. `006_organization_subscriptions.sql` - Table: `organization_subscriptions`
Tracks active & historical subscription lifecycle states per organization.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Subscription ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` ON DELETE CASCADE | Owning organization |
| `plan_id` | UUID | NOT NULL, FK → `plans(id)` | Subscribed plan |
| `status` | billing_subscription_status | NOT NULL | Current status (`active`, `trialing`, etc.) |
| `provider` | billing_provider_type | NOT NULL, DEFAULT 'system' | Provider (Stripe, Razorpay, etc.) |
| `billing_interval` | billing_interval_type | NOT NULL | `monthly` or `annual` |
| `provider_customer_id` | VARCHAR(150) | NULLABLE | External provider customer ID |
| `provider_subscription_id` | VARCHAR(150) | NULLABLE | External provider subscription ID |
| `current_period_start` | TIMESTAMPTZ | NOT NULL | Current billing period start |
| `current_period_end` | TIMESTAMPTZ | NOT NULL | Current billing period end |
| `trial_start` | TIMESTAMPTZ | NULLABLE | Trial start time |
| `trial_end` | TIMESTAMPTZ | NULLABLE | Trial end time |
| `cancel_at_period_end` | BOOLEAN | NOT NULL, DEFAULT FALSE | Auto-cancel pending flag |
| `cancelled_at` | TIMESTAMPTZ | NULLABLE | Cancellation time |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 07. `007_subscription_events.sql` - Table: `subscription_events`
Immutable history of subscription lifecycle state transitions.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Event ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` ON DELETE CASCADE | Organization ID |
| `subscription_id` | UUID | NOT NULL, FK → `organization_subscriptions(id)` | Subscription ID |
| `event_type` | subscription_event_type | NOT NULL | Event classification (`created`, `upgraded`, etc.) |
| `actor` | subscription_event_actor | NOT NULL | Triggering actor (`user`, `system`, etc.) |
| `actor_user_id` | UUID | NULLABLE, FK → `users(id)` ON DELETE SET NULL | Triggering user ID |
| `old_plan_id` | UUID | NULLABLE, FK → `plans(id)` ON DELETE SET NULL | Previous plan ID |
| `new_plan_id` | UUID | NULLABLE, FK → `plans(id)` ON DELETE SET NULL | New plan ID |
| `request_id` | UUID | NULLABLE | Request trace ID |
| `correlation_id` | UUID | NULLABLE | Event correlation ID |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Event timestamp |

---

### 08. `008_subscription_addons.sql` - Table: `subscription_addons`
Purchased capacity add-ons supplementing base plan entitlements.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Add-on ID |
| `subscription_id` | UUID | NOT NULL, FK → `organization_subscriptions(id)` | Subscription ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Organization ID |
| `feature_id` | UUID | NOT NULL, FK → `billing_features(id)` | Boosted feature ID |
| `quantity` | BIGINT | NOT NULL, CHECK (>0) | Purchased quantity increment |
| `starts_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Add-on active start |
| `expires_at` | TIMESTAMPTZ | NULLABLE | Add-on expiration date |
| `provider` | billing_provider_type | NOT NULL, DEFAULT 'system' | Billing provider |
| `provider_reference` | VARCHAR(150) | NULLABLE | External provider reference |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'active' | `active`, `scheduled`, `expired`, `cancelled` |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |

---

### 09. `009_organization_feature_overrides.sql` - Table: `organization_feature_overrides`
Custom per-organization feature entitlements overriding base plans.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Override ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Organization ID |
| `feature_id` | UUID | NOT NULL, FK → `billing_features(id)` | Overridden feature ID |
| `boolean_value` | BOOLEAN | NULLABLE | Override boolean |
| `integer_value` | BIGINT | NULLABLE | Override integer quota |
| `decimal_value` | NUMERIC(20,6) | NULLABLE | Override decimal quota |
| `string_value` | TEXT | NULLABLE | Override string |
| `reason` | TEXT | NOT NULL | Business reason for override |
| `effective_from` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Override effective start |
| `expires_at` | TIMESTAMPTZ | NULLABLE | Expiration time |
| `created_by` | UUID | NULLABLE, FK → `users(id)` | Creator user ID |
| `approved_by` | UUID | NULLABLE, FK → `users(id)` | Approver user ID |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 10. `010_organization_usage_current_period.sql` - Table: `organization_usage_current_period`
Single-row fast-path current period usage counters for instant quota verification.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `organization_id` | UUID | PRIMARY KEY, FK → `organizations(id)` | Owning organization |
| `subscription_id` | UUID | NULLABLE, FK → `organization_subscriptions(id)` | Active subscription |
| `period_start` | TIMESTAMPTZ | NOT NULL | Active period start |
| `period_end` | TIMESTAMPTZ | NOT NULL | Active period end |
| `events_used` | BIGINT | NOT NULL, DEFAULT 0 | Ingested events count |
| `ai_credits_used` | BIGINT | NOT NULL, DEFAULT 0 | AI credits consumed |
| `projects_used` | INTEGER | NOT NULL, DEFAULT 0 | Current active projects |
| `members_used` | INTEGER | NOT NULL, DEFAULT 0 | Current org members |
| `api_keys_used` | INTEGER | NOT NULL, DEFAULT 0 | Current API keys |
| `connectors_used` | INTEGER | NOT NULL, DEFAULT 0 | Active connectors |
| `alert_rules_used` | INTEGER | NOT NULL, DEFAULT 0 | Active alert rules |
| `dashboards_used` | INTEGER | NOT NULL, DEFAULT 0 | Active dashboards |
| `event_limit` | BIGINT | NOT NULL, DEFAULT 0 | Cached effective event quota |
| `ai_credit_limit` | BIGINT | NOT NULL, DEFAULT 0 | Cached effective AI quota |
| `overage_events` | BIGINT | NOT NULL, DEFAULT 0 | Events over limit |
| `overage_ai_credits` | BIGINT | NOT NULL, DEFAULT 0 | AI credits over limit |
| `last_event_at` | TIMESTAMPTZ | NULLABLE | Timestamp of last event |
| `last_ai_request_at` | TIMESTAMPTZ | NULLABLE | Timestamp of last AI request |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |

---

### 11. `011_usage_daily_counters.sql` - Partitioned Table: `usage_daily_counters`
Parent range-partitioned table by `usage_date` tracking daily usage counts.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | NOT NULL, DEFAULT `gen_random_uuid()` | Row ID (Composite PK with `usage_date`) |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Organization ID |
| `project_id` | UUID | NULLABLE, FK → `projects(id)` | Project ID |
| `usage_date` | DATE | NOT NULL | Usage date (Partition Key) |
| `events_count` | BIGINT | NOT NULL, DEFAULT 0 | Total ingested events |
| `ai_credits_used` | BIGINT | NOT NULL, DEFAULT 0 | AI credits spent |
| `requests_count` | BIGINT | NOT NULL, DEFAULT 0 | HTTP requests count |
| `errors_count` | BIGINT | NOT NULL, DEFAULT 0 | Errors count |
| `traces_count` | BIGINT | NOT NULL, DEFAULT 0 | Traces count |
| `spans_count` | BIGINT | NOT NULL, DEFAULT 0 | Spans count |
| `metrics_count` | BIGINT | NOT NULL, DEFAULT 0 | Metrics count |
| `logs_count` | BIGINT | NOT NULL, DEFAULT 0 | Log lines count |
| `profiles_count` | BIGINT | NOT NULL, DEFAULT 0 | CPU profiles count |
| `replays_count` | BIGINT | NOT NULL, DEFAULT 0 | Session replays count |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |

- **Default Monthly Partition**: `usage_daily_counters_2026_07` (FOR VALUES FROM `'2026-07-01'` TO `'2026-08-01'`)

---

### 12. `012_ai_usage_logs.sql` - Partitioned Table: `ai_usage_logs`
Immutable ledger of AI feature consumption partitioned by `occurred_at`.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | NOT NULL, DEFAULT `gen_random_uuid()` | Log ID (Composite PK with `occurred_at`) |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Organization ID |
| `project_id` | UUID | NULLABLE, FK → `projects(id)` | Project ID |
| `user_id` | UUID | NULLABLE, FK → `users(id)` | Requesting user |
| `occurred_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Timestamp (Partition Key) |
| `feature_key` | VARCHAR(100) | NOT NULL | AI feature used (e.g. `ai_chat`) |
| `provider` | VARCHAR(50) | NOT NULL | Model provider (OpenAI, Anthropic) |
| `model` | VARCHAR(100) | NOT NULL | Model name (e.g. `gpt-4o`) |
| `credits_used` | INTEGER | NOT NULL, DEFAULT 0 | Billing credits deducted |
| `prompt_tokens` | INTEGER | NOT NULL, DEFAULT 0 | Input tokens |
| `completion_tokens` | INTEGER | NOT NULL, DEFAULT 0 | Output tokens |
| `total_tokens` | INTEGER | GENERATED ALWAYS AS (`prompt_tokens + completion_tokens`) STORED | Total token count |
| `estimated_cost_usd` | NUMERIC(12,6) | NOT NULL, DEFAULT 0 | Provider cost estimation |
| `duration_ms` | INTEGER | NULLABLE | Execution duration in ms |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'success' | `success`, `failed`, `timeout`, `cancelled` |
| `request_id` | UUID | NULLABLE | Request correlation ID |
| `trace_id` | UUID | NULLABLE | OpenTelemetry trace ID |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Request metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Log entry timestamp |

- **Default Monthly Partition**: `ai_usage_logs_2026_07` (FOR VALUES FROM `'2026-07-01'` TO `'2026-08-01'`)

---

### 13. `013_invoices.sql` - Table: `invoices`
Invoice records generated for subscriptions and plan overages.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Invoice ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Billed organization |
| `subscription_id` | UUID | NULLABLE, FK → `organization_subscriptions(id)` | Target subscription |
| `provider` | billing_provider_type | NOT NULL | Provider (Stripe, Razorpay, etc.) |
| `provider_invoice_id` | VARCHAR(150) | NULLABLE | External provider invoice ID |
| `invoice_number` | VARCHAR(100) | NOT NULL, UNIQUE | Human-readable invoice number |
| `status` | billing_invoice_status | NOT NULL | Invoice status (`open`, `paid`, etc.) |
| `currency` | CHAR(3) | NOT NULL | Currency ISO code |
| `subtotal_amount` | BIGINT | NOT NULL, DEFAULT 0 | Subtotal in minor currency unit |
| `tax_amount` | BIGINT | NOT NULL, DEFAULT 0 | Tax in minor currency unit |
| `discount_amount` | BIGINT | NOT NULL, DEFAULT 0 | Discount in minor currency unit |
| `total_amount` | BIGINT | NOT NULL, DEFAULT 0 | Final total in minor currency unit |
| `amount_paid` | BIGINT | NOT NULL, DEFAULT 0 | Amount paid to date |
| `tax_rate` | NUMERIC(6,3) | NULLABLE | Applied tax percentage |
| `tax_id_snapshot` | VARCHAR(100) | NULLABLE | Org Tax ID (GST, VAT) snapshot |
| `billing_address_snapshot` | JSONB | NULLABLE | Billing address snapshot |
| `period_start` | TIMESTAMPTZ | NOT NULL | Invoiced period start |
| `period_end` | TIMESTAMPTZ | NOT NULL | Invoiced period end |
| `due_at` | TIMESTAMPTZ | NULLABLE | Due date |
| `paid_at` | TIMESTAMPTZ | NULLABLE | Payment timestamp |
| `overage_events` | BIGINT | NOT NULL, DEFAULT 0 | Invoiced overage events |
| `overage_amount` | BIGINT | NOT NULL, DEFAULT 0 | Overage amount in minor currency |
| `pdf_url` | TEXT | NULLABLE | Downloadable PDF URL |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Invoice creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 14. `014_payments.sql` - Table: `payments`
Transaction ledger recording payment attempts, status, fees, and refunds.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Payment ID |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Payer organization |
| `invoice_id` | UUID | NULLABLE, FK → `invoices(id)` | Associated invoice |
| `subscription_id` | UUID | NULLABLE, FK → `organization_subscriptions(id)` | Associated subscription |
| `provider` | billing_provider_type | NOT NULL | Payment provider |
| `provider_payment_id` | VARCHAR(150) | NULLABLE | Provider transaction ID |
| `provider_order_id` | VARCHAR(150) | NULLABLE | Provider order ID |
| `status` | billing_payment_status | NOT NULL | Transaction status (`succeeded`, `failed`, etc.) |
| `currency` | CHAR(3) | NOT NULL | Currency ISO code |
| `amount` | BIGINT | NOT NULL, CHECK (>=0) | Charged amount |
| `fee_amount` | BIGINT | NOT NULL, DEFAULT 0 | Gateway processing fee |
| `tax_amount` | BIGINT | NOT NULL, DEFAULT 0 | Included tax amount |
| `refunded_amount` | BIGINT | NOT NULL, DEFAULT 0 | Amount refunded |
| `payment_method` | VARCHAR(50) | NULLABLE | Payment type (`card`, `upi`, `bank_transfer`) |
| `payment_method_last4` | VARCHAR(10) | NULLABLE | Last 4 digits of card/account |
| `initiated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Initiation timestamp |
| `authorized_at` | TIMESTAMPTZ | NULLABLE | Authorization timestamp |
| `captured_at` | TIMESTAMPTZ | NULLABLE | Charge capture timestamp |
| `failed_at` | TIMESTAMPTZ | NULLABLE | Failure timestamp |
| `refunded_at` | TIMESTAMPTZ | NULLABLE | Refund timestamp |
| `failure_code` | VARCHAR(100) | NULLABLE | Gateway failure error code |
| `failure_reason` | TEXT | NULLABLE | Human-readable failure explanation |
| `idempotency_key` | VARCHAR(150) | NULLABLE, UNIQUE | Idempotency token |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 15. `015_billing_webhook_events.sql` - Table: `billing_webhook_events`
Inbox table for payment gateway webhooks ensuring idempotency and retry handling.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Event ID |
| `provider` | billing_provider_type | NOT NULL | Provider source |
| `provider_event_id` | VARCHAR(200) | NOT NULL | Provider event ID (UNIQUE with provider) |
| `event_type` | VARCHAR(150) | NOT NULL | Webhook event type (e.g. `invoice.payment_succeeded`) |
| `organization_id` | UUID | NULLABLE, FK → `organizations(id)` | Resolved organization ID |
| `payload` | JSONB | NOT NULL | Raw webhook payload |
| `payload_sha256` | CHAR(64) | NULLABLE | SHA256 checksum of payload |
| `signature_verified` | BOOLEAN | NOT NULL, DEFAULT FALSE | Signature validation status |
| `api_version` | VARCHAR(50) | NULLABLE | Gateway API version |
| `processing_status` | VARCHAR(20) | NOT NULL, DEFAULT 'received' | `received`, `processing`, `processed`, `failed`, `ignored`, `dead_letter` |
| `retry_count` | INTEGER | NOT NULL, DEFAULT 0 | Retry attempts count |
| `next_retry_at` | TIMESTAMPTZ | NULLABLE | Scheduled next retry |
| `processing_started_at` | TIMESTAMPTZ | NULLABLE | Processing start time |
| `processed_at` | TIMESTAMPTZ | NULLABLE | Completion timestamp |
| `processing_duration_ms` | INTEGER | NULLABLE | Duration in ms |
| `request_id` | UUID | NULLABLE | Correlation request ID |
| `correlation_id` | UUID | NULLABLE | Correlation ID |
| `last_error` | TEXT | NULLABLE | Last error message |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `received_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Received timestamp |

---

### 16. `016_coupons.sql` - Table: `coupons`
Promotional discount definitions supporting percentage and fixed value discounts.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Coupon ID |
| `code` | VARCHAR(50) | NOT NULL, UNIQUE | Redemption promo code |
| `name` | VARCHAR(150) | NOT NULL | Coupon title |
| `description` | TEXT | NULLABLE | Coupon terms description |
| `discount_type` | billing_coupon_discount_type | NOT NULL | `percentage` or `fixed_amount` |
| `discount_value` | NUMERIC(12,2) | NOT NULL, CHECK (>0) | Discount amount or percentage (1-100) |
| `currency` | CHAR(3) | NULLABLE | Currency if fixed amount discount |
| `max_redemptions` | INTEGER | NULLABLE | Global maximum redemptions limit |
| `redemption_count` | INTEGER | NOT NULL, DEFAULT 0 | Current redemptions count |
| `max_redemptions_per_org` | INTEGER | NOT NULL, DEFAULT 1 | Max redemptions per organization |
| `first_time_customers_only` | BOOLEAN | NOT NULL, DEFAULT FALSE | Restricted to new customers |
| `trial_only` | BOOLEAN | NOT NULL, DEFAULT FALSE | Restricted to trials |
| `valid_from` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Coupon active start |
| `valid_until` | TIMESTAMPTZ | NULLABLE | Expiration date |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Active flag |
| `is_public` | BOOLEAN | NOT NULL, DEFAULT FALSE | Publicly listed flag |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Update timestamp |
| `deleted_at` | TIMESTAMPTZ | NULLABLE | Soft-delete timestamp |

---

### 17. `017_coupon_redemptions.sql` - Table: `coupon_redemptions`
Redemption records linking coupons to organizations, subscriptions, and invoices.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY, `gen_random_uuid()` | Redemption ID |
| `coupon_id` | UUID | NOT NULL, FK → `coupons(id)` | Redeemed coupon |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Redeeming organization |
| `subscription_id` | UUID | NULLABLE, FK → `organization_subscriptions(id)` | Applied subscription |
| `invoice_id` | UUID | NULLABLE, FK → `invoices(id)` | Applied invoice |
| `redeemed_by` | UUID | NULLABLE, FK → `users(id)` | Redeeming user |
| `discount_amount` | BIGINT | NOT NULL, DEFAULT 0 | Applied discount amount |
| `currency` | CHAR(3) | NOT NULL | Currency ISO code |
| `redemption_source` | VARCHAR(30) | NOT NULL, DEFAULT 'manual' | `manual`, `checkout`, `admin`, `promotion`, `api` |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Metadata |
| `redeemed_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Redemption timestamp |

---

### 18. `018_coupon_applicable_plans.sql` - Table: `coupon_applicable_plans`
Junction table specifying which billing plans a coupon can be redeemed against.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `coupon_id` | UUID | NOT NULL, FK → `coupons(id)` ON DELETE CASCADE | Target coupon |
| `plan_id` | UUID | NOT NULL, FK → `plans(id)` ON DELETE CASCADE | Allowed plan |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Association timestamp |

- **Primary Key**: Composite `(coupon_id, plan_id)`

---

### 19. `019_billing_audit_logs.sql` - Partitioned Table: `billing_audit_logs`
Immutable audit log partitioned by `occurred_at` recording all billing operations.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | UUID | NOT NULL, DEFAULT `gen_random_uuid()` | Audit ID (Composite PK with `occurred_at`) |
| `organization_id` | UUID | NOT NULL, FK → `organizations(id)` | Organization ID |
| `subscription_id` | UUID | NULLABLE, FK → `organization_subscriptions(id)` | Subscription ID |
| `invoice_id` | UUID | NULLABLE, FK → `invoices(id)` | Invoice ID |
| `payment_id` | UUID | NULLABLE, FK → `payments(id)` | Payment ID |
| `coupon_id` | UUID | NULLABLE, FK → `coupons(id)` | Coupon ID |
| `actor_type` | subscription_event_actor | NOT NULL | Actor category (`user`, `admin`, etc.) |
| `actor_user_id` | UUID | NULLABLE, FK → `users(id)` | Performing user ID |
| `action` | VARCHAR(100) | NOT NULL | Executed operation name |
| `request_id` | UUID | NULLABLE | HTTP request ID |
| `correlation_id` | UUID | NULLABLE | Event correlation ID |
| `trace_id` | UUID | NULLABLE | OpenTelemetry trace ID |
| `ip_address` | INET | NULLABLE | Client IP address |
| `user_agent` | TEXT | NULLABLE | Client user agent string |
| `previous_state` | JSONB | NULLABLE | State before mutation |
| `new_state` | JSONB | NULLABLE | State after mutation |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Additional context |
| `occurred_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Action timestamp (Partition Key) |

- **Default Monthly Partition**: `billing_audit_logs_2026_07` (FOR VALUES FROM `'2026-07-01'` TO `'2026-08-01'`)

---

### 20. `020_views_and_functions.sql` - Views & Functions

#### Views
1. **`v_effective_entitlements`**: Combines `organization_subscriptions`, `plans`, `plan_feature_entitlements`, `billing_features`, and `organization_feature_overrides` to return active effective limits per organization.
2. **`v_current_usage`**: Exposes current billing period consumption, limits, and remaining balances from `organization_usage_current_period`.
3. **`v_subscription_summary`**: Provides a high-level subscription summary including plan name, key, tier, status, interval, and renewal dates.

#### Stored Helper Functions
- `get_effective_integer_feature(p_organization_id UUID, p_feature_key TEXT) RETURNS BIGINT`
- `has_feature(p_organization_id UUID, p_feature_key TEXT) RETURNS BOOLEAN`
- `remaining_event_quota(p_organization_id UUID) RETURNS BIGINT`
- `remaining_ai_credits(p_organization_id UUID) RETURNS BIGINT`
- `increment_event_usage(p_organization_id UUID, p_count BIGINT) RETURNS VOID`
- `consume_ai_credits(p_organization_id UUID, p_credits BIGINT) RETURNS VOID`
