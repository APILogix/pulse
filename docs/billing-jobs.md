# Billing Jobs

The billing job system is registered from `src/modules/billing/queue.ts` and runs on pg-boss. It is safe to register from the worker process and the standalone cron process because schedules are persisted in PostgreSQL and each scheduled job is delivered to one consumer.

## Architecture

`Scheduler -> Job Definition -> BillingJobsService -> BillingJobsRepository -> PostgreSQL`

Job files under `src/modules/billing/jobs/*.job.ts` are thin entry points. Business behavior lives in `BillingJobsService`; SQL lives in `BillingJobsRepository`.

## Jobs

- `billing.subscription-renewal`
- `billing.trial-expiration`
- `billing.invoice-generation`
- `billing.payment-sync`
- `billing.payment-reconciliation`
- `billing.webhook-retry`
- `billing.webhook-dead-letter`
- `billing.usage-rollover`
- `billing.usage-aggregation`
- `billing.ai-credit-reset`
- `billing.coupon-expiration`
- `billing.addon-expiration`
- `billing.feature-override-expiration`
- `billing.invoice-reminder`
- `billing.partition-creator`
- `billing.partition-cleanup`
- `billing.usage-anomaly`
- `billing.entitlement-refresh`
- `billing.audit-archive`
- `billing.data-reconciliation`
- `billing.metrics`

## Configuration

All runtime knobs are env-backed through `loadBillingJobConfig()`:

- `BILLING_JOB_BATCH_SIZE` default `500`
- `BILLING_JOB_MAX_BATCHES_PER_RUN` default `200`
- `BILLING_JOB_CONCURRENCY` default `1`
- `BILLING_JOB_RETRY_LIMIT` default `3`
- `BILLING_JOB_RETRY_DELAY_SECONDS` default `60`
- `BILLING_JOB_RETRY_BACKOFF` default `true`
- `BILLING_GRACE_PERIOD_DAYS` default `3`
- `BILLING_RETENTION_DAYS` default `365`
- `BILLING_AUDIT_ARCHIVE_RETENTION_DAYS` default `2555`
- `BILLING_WEBHOOK_MAX_RETRIES` default `12`
- `BILLING_INVOICE_REMINDER_DAYS` default `7,3,1,0`
- `BILLING_USAGE_ANOMALY_SPIKE_MULTIPLIER` default `3`
- `BILLING_USAGE_ANOMALY_MIN_EVENTS` default `1000`
- `BILLING_PARTITION_MONTHS_AHEAD` default `2`

Every job schedule can be overridden with `BILLING_<JOB>_CRON`, for example `BILLING_SUBSCRIPTION_RENEWAL_CRON`.

## Operational Notes

- Batched jobs commit after each batch and stop when a batch returns no work.
- Repository SQL uses bounded `LIMIT` batches and lock-safe candidates via `FOR UPDATE SKIP LOCKED` where rows are claimed.
- Webhook retries use capped exponential backoff and permanent failures move to `dead_letter`.
- Partition maintenance creates monthly partitions for usage, AI usage, and billing audit logs ahead of time.
- Metrics are emitted through Prometheus counters, gauges, and histograms with the `billing_job_*` prefix.
