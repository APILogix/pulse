# Ingestion Worker Gap Analysis

*Analysis only — no code changes. Companion to `OBSERVABILITY_TABLE_ANALYSIS.md`.*
*Verified against source at commit-time; every claim below is backed by a `file:line` reference.*

---

## 1. Worker inventory by event type

All 10 `SdkEventType`s (`error`, `message`, `request`, `span`, `trace`, `metric`, `log`, `profile`, `cron_checkin`, `replay`) route through pg-boss queues `ingest.<type>`, with a fallback to `ingest.error` (`queue/ingest-queues.ts:36-40`, `ingestQueueFor`). Queues: per-type `ingest.*` + DLQ `ingest.dlq-intake` + cron `ingest.usage-rollup` (singleton `usage-rollup`).

| Event type | Primary writer | Analytics workers | Usage counter column | Notable gap |
|---|---|---|---|---|
| `error` | `telemetry-writer.ts writeErrors` (multi-row `ON CONFLICT DO NOTHING`, 351/519-547) | `errors.worker` (summary/group/dimension/state), `event-analytics` fan-out (`rollupHourly`, `errorGrouping`), reconciler `refreshErrorGroups` | `errors_count` (usage-rollup.ts:43) | `analytics_error_groups.total_count` never written (see §3.1) |
| `message` | `writeErrors`-equivalent path | none | `events_count` only (`TYPE_TO_COLUMN` null, usage-rollup.ts:50) | No summary/group worker; no `messages_count` |
| `request` | events writer | none (requests read live from `events_requests` by dashboard) | `requests_count` | — |
| `span` / `trace` | events writer | none | `spans_count` / `traces_count` | — |
| `metric` | events writer | none | `metrics_count` | — |
| `log` | events writer | none | `logs_count` | — |
| `profile` | events writer | none | `profiles_count` | — |
| `replay` | events writer | none | `replays_count` | — |
| `cron_checkin` | events writer | none | `events_count` only (`TYPE_TO_COLUMN` null, usage-rollup.ts:51) | Same as `message` |
| any (failure) | `ingestion_failures` table | — | `ingestion_failure_count` (never incremented, see §3.3) | Write-orphan table |

## 2. Worker roles (verified at source)

| Worker | File | Role |
|---|---|---|
| Ingest worker | `pipeline/telemetry-writer.ts` | Writes `events_*` fact tables, multi-row `ON CONFLICT DO NOTHING`; error rows include endpoint chain + `httpStatus` (`STATUS_CODES`, 519-547) |
| Batch processor | `workers/event-processor.ts` (160-269) | DLQ batching + usage accounting; duplicates never billed |
| Analytics: errors | `analytics-engine/workers/errors.worker.ts` (1-62 contract, ~148-260 body) | Writes `error_metrics_1m`, `error_group_metrics_1m`, `error_dimension_metrics_1h`, and state upsert to `analytics_error_groups` (observation columns ONLY — see §3.1) |
| Analytics: fan-out | `event-analytics/queue.ts` | Every 5 min: `repo.listOrgsWithRecentErrors(2h)` → per-org `rollupHourly` + `errorGrouping`, job expiry 600 s |
| Analytics: reconciler | `event-analytics/repository.ts` `refreshErrorGroups` (820-846) | Inserts *missed* groups + refreshes descriptive fields; comment at 808-819 is stale (see §3.2) |
| Usage rollup | `ingestion/workers/usage-rollup.ts` (full, 225 lines) | Cron `ingest.usage-rollup` singleton; `DELETE ... RETURNING` billing counters from `usage_counter_staging` in one tx; per-org `increment_event_usage`; upsert `usage_daily_counters` (monthly partitions); after commit: `flush_usage_counters()` + `rollup_project_usage()` |
| DLQ writers | `worker-registry.ts:343` and `queue/pg-queue.ts:287` | Both `INSERT INTO ingestion_dead_letter_jobs` (two code paths, one table) |
| DLQ metrics | `metrics-server.ts:236` | `ingest_dlq_intake_total` counter |

## 3. Gaps

### 3.1 `analytics_error_groups.total_count` — dead column (severity: high)

- **Writer contract**: `errors.worker.ts` head comment (1-62) explicitly excludes counters from its state upsert — the state update only writes `organization_id, project_id, fingerprint, title, error_name, message_template, first_seen_at, last_seen_at, services, environments, releases, attributes` (upsert at ~229-260; comment 219-228: "adding to an existing counter is not idempotent … counts are owned by `error_group_metrics_*` and summed at read time").
- **Readers**: dashboard `SUM(total_count)` (`analytics/repository.ts` getDashboard, 220-271), `topErrors` ordered by `total_count DESC`, `listErrorGroups` aliases `total_count AS occurrences`.
- **Result**: dashboard occurrence totals and top-error ordering are driven by a column no code path ever increments → they read ~0 while the real counts live in `error_group_metrics_1m`. Confirmed write-orphan.

### 3.2 `refreshErrorGroups` stale comment (severity: medium — misleading maintenance doc)

`event-analytics/repository.ts:808-819` claims *"The ingestion worker's inline grouper owns occurrence counts in real time (analytics_error_groups.total_count etc. are incremented per inserted event). This periodic job must NOT add to counts…"* — **false**. The verified worker never increments counters (see §3.1); the reconciler itself only `INSERT`s missed groups (`total_count = COUNT(*)::int` set once on insert, never updated on conflict), i.e. the comment contradicts both the worker and its own behavior. Any maintainer reading it would believe the column is maintained.

### 3.3 `ingestion_failures` table + `ingestion_failure_count` column — write-orphans (severity: high)

- `ingestion_failures` (table 017; also bundled `002_create_all.sql:6838`, `002_create_all_ordered.sql:6835`, dropped in `001_drop_all.sql:24`): **no `INSERT INTO ingestion_failures` anywhere** (repo-wide grep). Table can never be non-empty.
- `ingestion_failure_count`: exists on the usage rollup grain (`api_key_usage_daily` — billing/usage/repository.ts:179 reads `SUM(u.ingestion_failure_count)` from `api_key_usage_daily u`) and on the project usage rollup (`api-key.repository.ts:532`). Reads: 2 (`api-key.repository.ts:97/532/547`, `billing/usage/repository.ts:179`); tests assert it (`canonical-migrations-draft*`, `project-core-runtime.test.ts:148`). **No writer found** — usage-rollup writes only `events_count` + 8 type columns (`usage-rollup.ts:41-52, 87-93`) and never touches failure columns. API-key dashboards will always show `ingestionFailures: 0`.
- Failure accounting in practice lives only in the DLQ table (`ingestion_dead_letter_jobs`, written at worker-registry.ts:343 + pg-queue.ts:287, read by `service.ts` health/management endpoints) and the `ingest_dlq_intake_total` counter.

### 3.4 Dual `events_errors` writers, no group linkage (severity: medium)

Both the ingest path (`telemetry-writer.ts writeErrors`) and replay/backfill write `events_errors` with `ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING`. Neither path associates a row with `analytics_error_groups` (no foreign key, no group_id column write), so group membership is re-derived by fingerprints only — consistent with the reconciler's "insert missed groups" design, but there is no backstop ensuring a group row exists for every persisted error event between runs.

### 3.5 `error_groups.assign()` is a no-op placeholder (severity: low)

`error-group.repository.ts:167` — assignment mutation never persists. Assignment lives only on `analytics_error_groups.assigned_to` (04_analytics/002). UI paths that call `assign()` on the `error_groups` (uppercase-status) tree silently no-op.

### 3.6 `message` / `cron_checkin` have no dedicated counters (severity: low)

`TYPE_TO_COLUMN` maps both to `null` (usage-rollup.ts:50-51): they count into `events_count` only, so per-type usage breakouts for messages/checkins are impossible from `usage_daily_counters`. No summary/dimension workers exist for them (only `error` has the analytics tree).

### 3.7 999-trigger backfill is migration-only (severity: info)

The backfill trigger/function in the migrations is executed at migration time; there is no worker keeping it warm. After initial install, backfill semantics are the reconciler's job (`refreshErrorGroups`) — which per §3.2 doesn't maintain counts.

## 4. Verified DLQ / replay machinery (completes the failure story)

| Endpoint | Behavior | Verified |
|---|---|---|
| `getDLQJobs` (service.ts:857-871) | `SELECT … FROM ingestion_dead_letter_jobs ORDER BY failed_at DESC OFFSET $1 LIMIT $2`, clamped offset/limit (max 1000) | yes |
| `reprocessDLQJob` (879-911) | Row must be `replayed_at IS NULL`; rebuilds payload via `dlqRowToJobPayload`, re-enqueues with same `jobPriority(planTier, eventType)` math, then marks `replayed_at = NOW(), replayed_by` | yes |
| `dlqRowToJobPayload` (919-1001) | 3 envelope paths: (1) full `IngestJobPayload` (env via `normalizeSdkEnvironment`; reject if absent — never fabricate an env dimension), (2) validation-reject `DlqIntakePayload` wrapper → unwrap `{event, detail}` → raw events re-processed (poison events re-fail validation), (3) bare historical rows → `null` (never replayed) | yes |
| `reprocessAllDLQ` (1003-1027) | Oldest-first `failed_at ASC`, per-row try/catch so one bad row doesn't stop the drain | yes |
| `replayEvents` (1034-1091) | `getEventsForReplay` → grouped per (environment × type) with original normalized env, `replay: true`, capped by `INGESTION_REPLAY_MAX_EVENTS` | yes |
| `getIngestionHealth` (804-836) | DLQ depth via `COUNT WHERE replayed_at IS NULL`, try/catch degrade-to-zero when the DLQ table doesn't exist on fresh installs | yes |

## 5. Verified writer/reader map (delta from `OBSERVABILITY_TABLE_ANALYSIS.md` §5)

| Object | Writer | Reader |
|---|---|---|
| `ingestion_dead_letter_jobs` | worker-registry.ts:343, pg-queue.ts:287 | service.ts:810/865/885/905, metrics-server.ts:236 |
| `usage_counter_staging` (`billing:%`) | UsageCounter (driveRollup:false) | usage-rollup.ts DELETE…RETURNING (146-155) |
| `usage_daily_counters` (monthly partitions) | usage-rollup.ts DAILY_UPSERT (87-93) | rollup_project_usage() / API-key analytics |
| `project_usage_realtime` | counter flush path | service.ts getProjectUsage (1117-1160) |
| `analytics_error_groups` (observation cols only) | errors.worker.ts state upsert (~229-260) | dashboard, event-analytics, reconciler insert |
| `analytics_error_groups.total_count` | **none** | dashboard `SUM(total_count)` / `topErrors` / `listErrorGroups` |
| `ingestion_failures` | **none** | none (no reads of the table at all) |
| `ingestion_failure_count` | **none** | api-key.repository.ts:97/532/547, billing/usage/repository.ts:179 |

## 6. Risk summary (observation only — no changes made)

1. **Dashboard error totals are effectively zeroed**: `getDashboard` reads `SUM(total_count)` from a column nobody writes. This is the highest-impact gap: user-facing totals/top-error lists are wrong while the real data sits in `error_group_metrics_1m`.
2. **API-key "ingestion failures" is permanently 0** in dashboards (no writer for `ingestion_failure_count`); operators will misread health.
3. **`ingestion_failures` table is dead weight**: DDL + indexes + drop entry, zero inserts. It shadows the actual DLQ mechanism and invites future confusion.
4. **Stale comment will cause future regressions**: anyone following `refreshErrorGroups`'s comment would "fix" the worker to increment counters, breaking its idempotency contract.
5. **Failure telemetry has no per-reason materialization**: `idx_ingestion_failures_reason` exists on the dead table; the live DLQ rows carry `last_error` but there is no maintained reason histogram.
