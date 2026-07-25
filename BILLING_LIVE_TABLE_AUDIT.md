# Billing Module Live Table Audit

Scope: corrected pass using live PostgreSQL catalog introspection and runtime code only.

Explicit exclusion: this pass did not read `src/db/postgres/migrations` or `src/db/postgres/canonical_migrations_draft` for schema conclusions.

Generated live schema snapshot: `LIVE_BILLING_SCHEMA_INTROSPECTION.json`.

Date: 2026-07-25

## Corrected Conclusion

The earlier audit skipped live table discovery and therefore understated the billing table surface. The live database has a broader billing schema than the previous report credited: add-ons, add-on prices, payment methods, coupon applicable plans, subscription summary/current usage views, project usage rollups, staging counters, webhook retry indexes, and add-on metadata are present.

However, after reading the live tables, the production-readiness conclusion does not improve. It gets more precise and slightly worse:

Overall billing production readiness: 2.5 / 10.

Reason: the live schema is richer, but runtime code and live DB are not aligned. The main AI billing repository references `ai_requests`, `credit_balances`, `credit_ledger`, and `ai_usage_receipts`, but those tables are absent from the live database. That means the AI credit reservation/ledger path would fail at runtime against this DB. The schema also contains important billing tables that have no registered or complete API surface.

## Live Billing-Adjacent Tables And Views

Partitioned tables:

- `ai_usage_logs`
- `billing_audit_logs`
- `project_usage_hourly_legacy`
- `usage_daily_counters`

Regular tables:

- `addon_prices`
- `addons`
- `ai_usage_logs_2026_07`
- `api_key_usage_minute`
- `billing_audit_logs_2026_07`
- `billing_features`
- `billing_webhook_events`
- `coupon_applicable_plans`
- `coupon_redemptions`
- `coupons`
- `invoice_line_items`
- `invoices`
- `organization_subscriptions`
- `organization_usage_current_period`
- `payment_methods`
- `payments`
- `plan_feature_entitlements`
- `plan_prices`
- `plans`
- `project_connector_subscriptions`
- `project_usage`
- `project_usage_daily`
- `project_usage_daily_legacy`
- `project_usage_hourly`
- `project_usage_hourly_default`
- `project_usage_minute`
- `project_usage_monthly`
- `subscription_addons`
- `subscription_events`
- `usage_counter_staging`
- `usage_daily_counters_2026_07`
- `usage_daily_counters_default`

Views:

- `project_usage_realtime`
- `v_current_usage`
- `v_effective_entitlements`
- `v_subscription_summary`

Enums present:

- `billing_coupon_discount_type`
- `billing_feature_category`
- `billing_feature_value_type`
- `billing_interval_type`
- `billing_invoice_status`
- `billing_payment_status`
- `billing_plan_tier`
- `billing_provider_type`
- `billing_status`
- `billing_subscription_status`
- `invoice_status`
- `payment_method_type`
- `subscription_event_actor`
- `subscription_event_type`

## Tables Present That Change The Previous Audit

The previous report said several things as if they were purely missing from schema. The live DB shows they exist:

- `payment_methods` exists, including default payment method uniqueness per org.
- `addons`, `addon_prices`, and `subscription_addons` exist.
- `coupon_applicable_plans` exists, so coupon-to-plan scoping is modeled in DB.
- `v_subscription_summary` exists.
- `usage_counter_staging` and `project_usage_realtime` exist for staged project usage counters.
- `project_usage_*` and `api_key_usage_minute` exist for project/API-key attribution.
- `billing_webhook_events` has `signature_verified`, payload hash, retry status, retry indexes, request/correlation IDs, and metadata.

Corrected interpretation: the database design is more enterprise-ready than I first stated. The implementation is the weak point, especially route registration, provider event processing, and code/schema alignment.

## Tables Missing From Live DB But Referenced By Runtime Code

The live DB did not contain these tables, but `src/modules/ai/repository.ts` references them:

- `ai_requests`
- `credit_balances`
- `credit_ledger`
- `ai_usage_receipts`

Impact:

- AI request preparation, cached response lookup, credit reservation, credit finalization, refund/release, and delivery confirmation can fail at runtime.
- The previous report’s credit-ledger discussion was too generous for this live DB. Against this DB, the ledger is not available.
- Any production readiness rating must penalize schema/runtime drift heavily.

## Live Schema Strengths

- `organization_subscriptions` has a partial unique index for one active/trialing/past_due non-deleted subscription per org.
- `organization_subscriptions` has provider subscription uniqueness.
- `invoices` has provider invoice uniqueness and status/period/org indexes.
- `payments` has provider payment uniqueness and idempotency-key uniqueness.
- `billing_webhook_events` has provider event uniqueness, retry status, retry indexes, signature verification field, payload hash field, metadata indexes, and request/correlation fields.
- `usage_daily_counters` and `ai_usage_logs` are partitioned.
- `project_usage_realtime` merges flushed project usage with unflushed staging data.
- `subscription_addons`, `addons`, and `addon_prices` model paid add-ons.
- `payment_methods` models provider payment methods and one default per org.

## Live Schema Problems

P0/P1:

- `v_effective_entitlements` still grants entitlements for `trialing`, `active`, and `past_due` without filtering `organization_subscriptions.deleted_at IS NULL`.
- `v_effective_entitlements` does not include period validity or past-due grace cutoff.
- `v_effective_entitlements` does not merge `subscription_addons`, even though add-on tables exist.
- `v_current_usage` exposes negative remaining values because it returns `event_limit - events_used` and `ai_credit_limit - ai_credits_used` without clamping.
- `usage_daily_counters` uniqueness is still `(organization_id, project_id, usage_date)` with nullable `project_id`; org-level rows with `project_id NULL` can duplicate in PostgreSQL.
- `ai_usage_logs.status` allows `success`, `failed`, `timeout`, and `cancelled`, while the internal billing repository inserts `accepted`.
- `billing_webhook_events.signature_verified` exists, but the runtime webhook service sets signature validation to a stubbed `true`; the table field does not protect anything by itself.
- `payment_methods` exists, but there is no complete billing payment-method API/service surface registered.

P2:

- `payments.uq_provider_payment` is not partial; this may reject multiple manual/system records with null `provider_payment_id` depending on DB null behavior and provider behavior. It is less dangerous than missing uniqueness, but should be reviewed.
- `invoices` has unique `invoice_number`, but no live unique constraint for `(organization_id, subscription_id, period_start, period_end)`.
- `organization_subscriptions` has `modules` and `addons` JSONB plus normalized `subscription_addons`; this can drift unless one is clearly derived from the other.
- Both `billing_status` and `billing_subscription_status` enums exist, which suggests schema generation/history drift.

## Runtime/API Gaps Against Live Tables

The live DB has more objects than the registered API exposes:

- `payment_methods` table exists, but there is no `/billing/payment-methods` route.
- `addons` and `addon_prices` exist, but there is no customer add-on catalog/purchase/update/cancel route.
- `subscription_addons` exists, but only expiration jobs reference it.
- `coupon_applicable_plans` exists, but coupon routes are implemented and not registered in `billing.module.ts`.
- `billing_webhook_events` is rich enough for processing/retry, but runtime only stores events and jobs only retry/dead-letter status. No domain processor applies invoice/subscription/payment changes.
- `project_usage_*` and `api_key_usage_minute` exist, but billing summary does not expose project/API-key cost attribution.
- `v_subscription_summary` exists, but organization billing summary does not use it as a complete read model.

## Corrected Missing API Route List

Must add or intentionally remove:

- Register `src/modules/billing/coupons/routes.ts` under `/billing/coupons`.
- Decide the fate of `src/modules/billing/ai/routes.ts`. Do not register it as-is unless it is reconciled with the main AI path and live schema.

Should add because live tables already exist:

- `/billing/payment-methods`
- `/billing/addons`
- `/billing/subscription/addons`
- `/billing/webhooks/events` for internal/admin retry and inspection.
- `/billing/audit-logs`
- `/billing/usage/project-attribution`
- `/billing/usage/api-key-attribution`
- `/billing/subscription/summary` backed by `v_subscription_summary` plus invoices/payments/usage.

Should add for provider correctness:

- `/billing/checkout/sessions`
- `/billing/customer-portal`
- `/billing/subscription/preview-change`
- `/billing/subscription/scheduled-change`
- `/billing/refunds`
- `/billing/credit-notes`
- `/billing/tax-profile`

## Revised Risk Rating

Database model breadth: 6.5 / 10.

The live DB has many enterprise billing concepts modeled.

Runtime/API completeness: 2.0 / 10.

Provider integrations, payment methods, add-ons, webhook processors, and customer billing surfaces are missing or incomplete.

Schema/runtime alignment: 2.0 / 10.

The AI module references critical tables that do not exist in the live DB.

Financial correctness: 2.0 / 10.

Cancellation renewal, unpaid renewal, webhook processing, idempotent metering, and AI credit persistence are not production-safe.

Overall billing readiness: 2.5 / 10.

## Updated P0 Actions

1. Fix live schema/runtime drift for AI billing. Either add the missing `ai_requests`, `credit_balances`, `credit_ledger`, and `ai_usage_receipts` tables, or remove those code paths and make AI billing use existing live tables.
2. Fix webhook verification and implement provider event processors.
3. Fix cancel-at-period-end renewal so cancelled subscriptions do not renew.
4. Fix `v_effective_entitlements` to filter deleted subscriptions, period validity, and grace cutoff.
5. Add idempotency for event usage and AI credit consumption.
6. Fix the internal AI usage status mismatch.
7. Register or remove unregistered billing routes so the API surface matches intended functionality.

## Updated Conclusion

Your concern was valid. Reading only migration-derived schema caused the first audit to miss live table reality. The corrected conclusion is:

- The DB schema is not as empty as the first report implied.
- The schema has useful enterprise structures for add-ons, payment methods, usage staging, project usage, and webhook retries.
- The system is still not production-ready because the API and runtime do not use much of that schema, webhook/payment processing is incomplete, and the AI credit path references tables that are absent from the live DB.
