# Observability Table Analysis

Source: `database/migrations/logdb/03_observability_v2/` (001–017 + 999) cross-referenced with the bundled DDL in `002_create_all.sql` / `002_create_all_ordered.sql`, `04_analytics/001` + `04_analytics/002`, and the `src/` writers/readers found via grep.

Scope: duplicate-field matrix, cross-table/cross-tree duplication, and write-orphans. No code changes — analysis only.

---

## 1. Table inventory (`03_observability_v2/`)

| File | Table | Distinctive columns |
|---|---|---|
| 001 | `events_requests` | `client_ip_hash`, `is_slow`, `is_error`, `request/response_headers`, `request/response_body`, `latency_ms` |
| 002 | `events_errors` | `fingerprint`, `error_name`, `error_message`, `stack_frames` |
| 003 | `events_logs` | CHECK `log_category`, `log_source` |
| 004 | `events_metrics` | aggregate columns |
| 005 | `events_spans` | span blocks |
| 006 | `events_traces` | trace tree |
| 007 | `events_messages` | — |
| 008 | `events_profiles` | — |
| 009 | `events_replays` | `user_ip INET` |
| 010 | `events_cron_checkins` | — |
| 011 | `error_groups` | tracking/regression/snapshot/merge columns + version lock; **NOT partitioned**; unique `(project_id, fingerprint)`; uppercase statuses |
| 012 | `error_group_history` | — |
| 013 | `ingestion_queue_snapshot` | — |
| 014 | `ingestion_metrics` | — |
| 015 | `worker_performance` | — |
| 016 | `backpressure_gauge` | CHECK constraint |
| 017 | `ingestion_failures` | **no code writer found (see §4)** |
| 999 | — | typed-event trigger backfilling `payload`/`metadata.environment` |

Common block across 001–009: `id UUID`, `organization_id UUID NOT NULL`, `project_id UUID`, `environment TEXT NOT NULL`, `api_key_id UUID`, `event_id TEXT NOT NULL`, correlation/SDK block, `severity logdb_severity`, `message`, `name`, `attributes`/`metadata`/`payload JSONB DEFAULT '{}'`, timestamp trio, `PRIMARY KEY (id, occurred_at)` with RANGE partition by `occurred_at` + `_default`.

---

## 2. Duplicate-field matrix

Legend: **W** = written by code, **R** = read by code, **D** = DDL only (no code refs), **—** = absent.

| Field | events_errors | error_groups | analytics_error_groups | error_group_metrics_1m | error_metrics_1m | error_group_history |
|---|---|---|---|---|---|---|
| `organization_id` | W | W | W | W | W | W |
| `project_id` | W | W | W | W | W | W |
| `environment(s)` | W | W | W | W | W | W |
| `fingerprint` | W | W | W | W | — | W |
| `error_name` | W | — | W | W | — | — |
| `total_count` / `occurrences` | — | W | **D (never written — §4)** | W | W | — |
| `severity` | W | — | — | — | W | — |
| `status` | — | W (uppercase) | W (lowercase, API-only) | — | — | W |
| `first_seen_at` / `last_seen_at` | — | W | W | — | — | W |

### Key duplication findings

1. **`error_groups` vs `analytics_error_groups`** — two parallel "grouped errors with status" tables with no sync:
   - `error_groups` (011): legacy, unique `(project_id, fingerprint)`, uppercase statuses (`OPEN/RESOLVED/IGNORED/ARCHIVED/REGRESSED`), written by `error-group.repository.ts upsertGroup`; API lifecycle via `error-grouping.service.ts` + `issue-lifecycle.service.ts`; `assign()` at `error-group.repository.ts:167` is a **no-op placeholder**.
   - `analytics_error_groups`: lowercase statuses, unique `(organization_id, project_id, fingerprint)`, priority/resolved columns, written only by the `analytics.errors` worker (observation columns only) and the `refreshErrorGroups` reconciler; triage mutation via `analytics/repository.ts` (~350–373).
   - Same logical concept maintained twice; statuses can diverge freely (no cross-writes).
2. **`events_errors` dual write paths** — `error.repository.ts insertError` (per-event ingest) and `telemetry-writer.ts writeErrors`/`buildInsert` (pipeline batch) both insert; dedupe only via `ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING`.
3. **Counts live in two places** — `error_group_metrics_1m.total_count` (worker-maintained, per bucket) vs `analytics_error_groups.total_count` (DDL-only; worker deliberately excludes it — see §4).
4. **`error_metrics_1m` vs `error_group_metrics_1m`** — overlapping summary columns (`total_count`, `fatal_count`, `error_count`, … `unique_users_exact`, `sample_count`) at two grains (per environment vs per group).
5. **`ingestion_failures` vs `ingestion_dead_letter_jobs`** — overlapping concepts with inverted ownership:
   - `ingestion_dead_letter_jobs`: **written** (`pg-queue.ts:287`, `worker-registry.ts:343`), read by `ingestion/service.ts` (810/865/885/905) and `metrics-server.ts:236` counter `ingest_dlq_intake_total`.
   - `ingestion_failures`: **write-orphan** (DDL only; the only `src/` hit is a billing alias `SUM(u.ingestion_failure_count)::bigint AS ingestion_failures` reading a *usage-rollup* column, not this table).

---

## 3. Duplicate DDL across migration trees

| Object | 03_observability_v2 | Bundled `002_create_all_ordered.sql` | Bundled `002_create_all.sql` | `04_analytics/*` |
|---|---|---|---|---|
| `ingestion_dead_letter_jobs` | — (logdb `13_ingestion/003` referenced by `02_ingestion/001`) | CREATE 5520, idx 5540/5542/5545/5548 | CREATE 5523, idx 5543/5545/5548/5551 | — |
| `ingestion_failures` | 017 | CREATE 6835, idx 6845/6846 | CREATE 6838, idx 6848/6849 | — |
| `analytics_error_groups` | — | — | CREATE 6402–6432 (**INTEGER** counts) | `001` (~52) + `002` (**BIGINT** counts, +priority/resolved_at/resolved_by/assigned_to, env array, is_crashed/performance) |

**Drift:** `analytics_error_groups` count columns are `INTEGER` in the bundled DDL but `BIGINT` in `04_analytics/002`. `priority`/`resolved_by` exist **only** on `analytics_error_groups` (confirmed by grep).

---

## 4. Write-orphans / dead columns

| Object | DDL | Code writer | Consequence |
|---|---|---|---|
| `ingestion_failures` (017 + bundled 6838) | yes | **none found** | Table stays empty; failure accounting only via usage-rollup `ingestion_failure_count` |
| `analytics_error_groups.total_count` | yes (INTEGER/BIGINT) | **none** — `errors.worker.ts` state upsert excludes counters by design ("adding to an existing counter is not idempotent… counts are owned by `error_group_metrics_*` and summed at read time") | Always `0`; but `getDashboard` reads `SUM(total_count)` (analytics/repository.ts:236), `topErrors` sorts by `total_count DESC` (255), `listErrorGroups` aliases `total_count AS occurrences` — all read the dead column |
| `refreshErrorGroups` comment (event-analytics/repository.ts ~820) | — | claims "ingestion worker increments `analytics_error_groups.total_count` per inserted event" | **stale comment** — contradicts worker behavior; reconciler itself only inserts missed groups + refreshes descriptive fields, never adds counts |

---

## 5. Confirmed writer/reader map (grep-verified)

| Table | Writers | Readers |
|---|---|---|
| `events_errors` | `error.repository.ts`, `telemetry-writer.ts` (519–547) | `errors.worker.ts` (SOURCE), dashboards |
| `error_metrics_1m` | `errors.worker.ts` (SUMMARY_TABLE) | analytics read paths |
| `error_group_metrics_1m` | `errors.worker.ts` (GROUP_TABLE) | — |
| `error_dimension_metrics_1h` | `errors.worker.ts` (DIMENSION_TABLE) | — |
| `analytics_error_groups` | `errors.worker.ts` state upsert (observation cols), `refreshErrorGroups` (INSERT missed only) | `analytics/repository.ts` dashboard/list/topErrors, alerts |
| `analytics_alerts` | `event-analytics/repository.ts createAlert` (760) | `listAlerts` (767), `getAlert` (772); `deleteAlert` (777, soft delete) |
| `ingestion_dead_letter_jobs` | `pg-queue.ts:287`, `worker-registry.ts:343` | `ingestion/service.ts` 810/865/885/905, `metrics-server.ts:236` |
| `error_groups` | `error-group.repository.ts upsertGroup` | `error-grouping.service.ts`, `issue-lifecycle.service.ts` |
| `error_group_history` | legacy lifecycle services | — |
| 999 trigger | migration backfill of `payload`/`metadata.environment` | — |

---

## 6. Priority/backpressure constants (context for the gap doc)

- `PLAN_WEIGHT`: enterprise 1000 … free 200 (dominant)
- `TYPE_URGENCY`: error/message/cron_checkin 100; request/span/trace 50; log 30; metric 20; profile/replay 10
- `FAIRNESS_AGE_BOOST = 25` per defer; `jobPriority = PLAN_WEIGHT + TYPE_URGENCY + deferCount*25`
- `TENANT_INFLIGHT_LIMIT`: enterprise 24, business 16, growth 8, starter 4, free 2
