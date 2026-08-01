# Phase 1 — Architecture Stabilization: Inconsistency Register

Every row is a defect found in the audit. Nothing here is speculative; each has a verified source.
`Resolution` is the redesign decision. No inconsistency is closed by patching code alone where the
data model is the actual defect.

## A. Duplicate / ambiguous schemas (critical)

| # | Inconsistency | Evidence | Resolution |
|---|---|---|---|
| A1 | `alert_events` defined **twice**: rich control-plane DDL (fingerprint, lifecycle timestamps, ack/resolve columns, `alert_event_status` enum) *and* a generic partitioned Log DB table (`(id, occurred_at)` PK, generic `status TEXT`, no fingerprint) | `08_alerting/005…` compiled into `002_create_all.sql`; `logdb/06_alert_runtime/001_alert_runtime.up.sql` | **Log DB is the single owner.** Replace the generic loop table with a *typed, append-oriented* `alert_events` + `alert_event_state` split (see `02-data-model.md` §3). Drop the control-plane copy after cutover. |
| A2 | `alert_delivery_attempts` defined twice (typed control-plane vs generic Log DB) | same files | Log DB owns. Typed schema with `notification_job_id`, `channel_kind`, `connector_id`, `attempt_number`. |
| A3 | `alert_throttle_windows` defined twice — normalized `(rule_action_id, window_start)` with real FK **and** generic Log DB partitioned table. Repositories (`getThrottleStates`, `recordThrottleNotifications`) expect the normalized shape | `08_alerting/017` (compiled) vs `logdb/06_alert_runtime` | **Delete both.** Replace with append-only `alert_notification_ledger` in Log DB; throttle counts are derived by time-window aggregation. Removes mutable runtime state and the dual-schema hazard in one move. |
| A4 | `connector_deliveries` defined twice — rich control-plane (correlation_id, attempts, next_retry_at, partitioned by created_at) vs generic Log DB (`status logdb_delivery_status` with `delivered`, not `sent`) | `06_connectors/005…`; `logdb/05_connectors_runtime/001…` | Log DB owns, typed. Status vocabulary unified to one enum (`pending, queued, sent, retrying, failed, suppressed, cancelled`). |
| A5 | `connector_delivery_attempts` in Log DB has **no `delivery_id`**, so attempts cannot be joined to their delivery; the control-plane version has a composite FK | `logdb/05_connectors_runtime` vs `06_connectors/006` | Typed Log DB table with `(delivery_id, delivery_created_at)` composite reference (no cross-DB FK needed — same DB). |
| A6 | `connector_health_checks`, `connector_test_runs`, `connector_audit_logs` all share one generic column set (no health-specific, test-specific, or actor/action columns) | `logdb/05_connectors_runtime` loop | Split into three purpose-built append-only tables. |

## B. Source-of-truth / cross-database defects (critical)

| # | Inconsistency | Evidence | Resolution |
|---|---|---|---|
| B1 | Ingestion writes `events_*` via `logDB.getPrimaryPool()`; the alert evaluator reads `events_*` via the control-plane `pool`. Works only if Log DB falls back to `DATABASE_URL` | `worker-registry.ts` ctor (`telemetryPool`), `evaluator/rule-evaluator.ts` imports `config/database.js` `pool` | **Hard rule:** all telemetry reads go through an injected `telemetryPool`. Evaluators are constructed with an explicit pool; a boot-time assertion fails fast if the alerting runtime pool cannot see `events_requests`. |
| B2 | Alerting repositories (`EventsRepository`, `RulesRepository`) use the primary pool for tables the current migrations place in Log DB | `alerting/events/events.repository.ts` | Repositories are split: `AlertConfigRepository` (primary pool) and `AlertRuntimeRepository` (Log DB pool). No repository may span both pools. |
| B3 | Alert truth is split across databases with no reconciliation: `alert_delivery_attempts` records `queued` while the real outcome lands in `connector_deliveries` | `batch-processor.deliverToConnector` returns `status:'queued'` | Both become Log DB tables joined by `notification_job_id`; a reconciliation job closes attempts from delivery terminal state. |
| B4 | No cross-DB foreign keys (by design) → dangling `connector_id`/`rule_id` after config deletion | `logdb/README.md`, `logdb_schema_notes` | Accepted, but formalized: runtime rows snapshot the resolved policy (`policy_snapshot JSONB`) so history stays explainable after config deletion. |

## C. Integrity / correctness gaps

| # | Inconsistency | Resolution |
|---|---|---|
| C1 | Log DB runtime tables never attach `logdb_set_updated_at()`; `updated_at` is a bare default and goes stale | Append-only tables drop `updated_at` entirely. The only mutable runtime row (`alert_event_state`) gets the trigger. |
| C2 | Only DEFAULT partitions exist for every runtime table — no time-bounded partitions, so retention pruning cannot drop partitions | A single partition manager job pre-creates monthly partitions for all runtime tables and detaches expired ones per plan retention. |
| C3 | Composite PK `(id, occurred_at)` means `id` is not unique; no idempotency constraint on deliveries, attempts, batches, acks, or throttle windows | Every runtime table gets an explicit idempotency unique index (see `02-data-model.md`). |
| C4 | Two unsynchronized circuit breakers: in-process (`runtime.ts`, threshold 5/30s) and DB-derived (`delivery.service.ts circuitOpen` using `consecutive_failures`) | One DB-backed breaker: `connector_circuit_state` in primary DB, read-through cached in-process for 1s. |
| C5 | Rate limiter is per-process sliding window → effective limit multiplies by process count | DB-backed atomic token bucket `connector_rate_buckets` (primary), satisfying the "global rate limiting" success criterion without Redis. |
| C6 | Connector DLQ is stored as an audit-log row (`action='delivery.dead_lettered'`), so there is no queryable DLQ or replay path | Dedicated append-only `connector_dead_letters` in Log DB + `connector.dlq` queue + explicit replay API. |
| C7 | Legacy 3-segment ciphertext with a hardcoded scrypt salt is still accepted | Keep read compatibility; add a rotation job that re-encrypts legacy blobs and a metric for remaining legacy rows. |

## D. Product / business-logic gaps

| # | Inconsistency | Resolution |
|---|---|---|
| D1 | No rule inheritance. `alert_rules.project_id` is a single nullable FK: a rule is either org-wide or one project. A project cannot disable or override an org rule | `alert_rule_bindings` + Effective Rule Resolution (`02-data-model.md` §1, `03-policy-engine.md`). |
| D2 | Project thresholds (`project_alert_thresholds`) run as a **separate** evaluator; a project-wide and an environment threshold for the same key both fire independently | Thresholds become a rule layer; one effective threshold per scope chain (Phase 4). |
| D3 | Entitlements and quotas are fully seeded but **never checked** in the alerting or connectors modules; `adjustResource` has zero callers | Entitlement guard at API write paths + Policy Engine gate (`06-entitlements-and-usage.md`). |
| D4 | Nothing about alerts or deliveries is metered for billing; `alert_rules_used`/`connectors_used` are never written | Append-only usage ledger + rollup (Phase 11). |
| D5 | `quota.connectors` is referenced in code but never seeded; there is no SMS feature key and no daily/monthly alert limit key | New seed migration adds the missing feature keys and plan values. |
| D6 | The 19 seeded default presets create a `notify` action with **no connector and no route**, and `isDeliverAction()` requires one — so out-of-the-box defaults never deliver externally | Presets request **channels** (`in_app`, `email`), and channel resolution maps them to a connector or managed SMTP. Fixes the defaults without changing preset semantics. |
| D7 | `analytics_alerts` exists in Log DB with no evaluator wired to it | Declared legacy; excluded from the new pipeline and scheduled for removal after confirming no consumer. |
| D8 | Rule/action changes are not versioned (in-place mutation, only `updated_at`) | `alert_rule_revisions` append-only history in primary; each alert event snapshots the policy it executed. |
| D9 | No rule priority at rule level, no rule dependencies, no service/endpoint scope | Priority on bindings; scope ladder adds environment/service/endpoint; dependencies expressed as composite rules (Phase 14). |

## E. Capabilities that must be preserved (explicit no-regression list)

These already work and must survive the migration unchanged in behaviour:

- Dedup by fingerprint with `duplicate_count` folding; silence matching at ingest.
- Cooldown + consecutive-breach counting; auto-resolve; recovery resolution.
- `FOR UPDATE SKIP LOCKED` claiming for batches, escalations, retries, dead letters.
- Batch processing with bulk queries/writes and bounded concurrency (no N+1).
- Escalation sweep incl. expired-acknowledgment resume.
- Connector idempotency (advisory lock + `(connector_id, correlation_id)` 24h window) and 5-minute `dedupKey` suppression.
- Retry with exponential backoff + full jitter; stale-pending recovery after 5 minutes.
- OAuth PKCE start/complete/refresh/disconnect with credential versioning (`connector_secret_versions`).
- AES-256-GCM per-record salt/IV credential encryption.
- Project recipient resolution incl. quiet hours, digest mode, severity ladder, active-membership enforcement, fail-closed project delivery.
- Webhook HMAC signing and SSRF-guarded URL validation.
- Ingestion tenant fairness, plan-aware backpressure, DLQ intake, usage rollup, `/metrics` + `/healthz`.
