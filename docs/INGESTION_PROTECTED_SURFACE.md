# Ingestion Protected Surface (Phase 0A)

**Purpose:** this file is the pre-committed contract for the enterprise-incidents work. It
enumerates the ingestion-critical surface BEFORE any change, so "we did not disturb
ingestion" can be verified mechanically at the end (`git diff --name-only` against this list)
rather than asserted.

**Rule:** no file in this document may be modified by alerting/incident work. If one must
change, the reason must be written here first, with the ingestion impact analysed.

**Status at end of this workstream: ZERO files below were modified.** See
`docs/ENTERPRISE_INCIDENTS_REPORT.md` §27 for the verification command and its output.

---

## Tier 1 — hot path (any edit is an ingestion-throughput change)

| File | Why protected |
|---|---|
| `src/modules/ingestion/workers/event-processor.ts` | Owns the ingestion transaction: `BEGIN` (547), `SET LOCAL` tuning (549), telemetry INSERT dispatch, `appendTelemetryOutbox` (658/669), `COMMIT` (679), `ROLLBACK` (695). ACK is downstream of COMMIT. |
| `src/modules/ingestion/pipeline/telemetry-writer.ts` | Executes every telemetry INSERT; contains `appendTelemetryOutbox` (706) and its 3-CTE UNNEST SQL writing `alert_runtime_idempotency_keys` (776) and `telemetry_outbox` (778). This is the alerting coupling point. |
| `src/modules/ingestion/pipeline/write-admission.ts` | FIFO write semaphore + `resolveWritePermits()`. Exists to solve a *measured* overload problem (320 handlers vs pool of 10). |
| `src/modules/ingestion/service.ts` | Chunking, byte budgeting, backpressure (`CIRCUIT_OPEN`), and `enqueueIngestJobs()` — the client-facing durability boundary. |
| `src/modules/ingestion/queue/ingest-queues.ts` | Queue names, plan/type priorities, per-tenant in-flight fairness constants, `pgboss.job` depth probe. |
| `src/shared/workers/ingestion-worker-main.ts` | Pool construction/sizing: control pool + dedicated telemetry write pool. |
| `src/modules/ingestion/workers/worker-registry.ts` | Worker fan-out and the tenant-fairness gate. |

## Tier 2 — request path and normalization

`controller.ts`, `routes.ts`, `route-table.ts`, `types.ts`, `rate-limiter.ts`,
`pipeline/event-normalizer.ts`, `pipeline/request-enrichment.ts`, `pipeline/ingestion-abort.ts`,
`pipeline/ingestion-job-handler.ts`, `postgress.writter.ts`, `ingestion.module.ts`,
`usage/usage-counter.ts`, `utils/api-key.ts` (all under `src/modules/ingestion/`).

> `pipeline/event-normalizer.ts` deserves special note: it is imported **at runtime** by
> `src/modules/alerting/runtime/engines.ts:31` (`resolveTimestamp`). Adding side-effectful
> top-level code there would execute inside the alerting worker too.

## Tier 3 — shared infrastructure ingestion depends on

- `src/config/database.ts` — the shared PRIMARY pool
- `src/config/log-database.ts` — Log DB pools
- `src/lib/pgboss.ts` — pg-boss singleton (schema lives in the PRIMARY database)
- `src/modules/errors/repositories/error-group.repository.ts` — runs *inside* the ingestion
  transaction and already writes `telemetry_outbox`

## Tier 4 — schema objects that must not gain columns, indexes, or triggers

- `telemetry_outbox`
- `alert_runtime_idempotency_keys`
- all `events_*` / typed telemetry tables and their `trg_sync_typed_event_contract` triggers
- `pgboss.job` (PRIMARY DB)

Adding even an index to `telemetry_outbox` would land inside ingestion's `BEGIN…COMMIT`.

---

## Verified isolation facts (from audit, with citations)

| Question | Answer | Evidence |
|---|---|---|
| Does ingestion synchronously call alerting? | **No** | Zero matches for `alerting` in `src/modules/ingestion/**`. The dependency arrow is alerting → ingestion, never the reverse. |
| Which direction does the coupling run? | alerting → ingestion, type-only + one util | `engines.ts:29` (type-only `ScopedEvent`), `engines.ts:31` (runtime `resolveTimestamp`) |
| Per-event Redis in ingestion? | **No** | Ingestion is Postgres-only; rate limiting is process-local (`rate-limiter.ts:5-8`); health honestly reports `redis: false` (`service.ts:966`) |
| DB trigger from ingestion tables into alerting tables? | **No** | All triggers on ingestion tables only populate `NEW.*` / `public_id` / `updated_at`. Every alerting write on the ingestion path is explicit application SQL. |
| Where is the client acknowledged? | `202` at `controller.ts:174` (typed hot path) | Durable once `enqueueIngestJobs()` resolves = pg-boss job row committed in PRIMARY |
| Is the outbox write in the telemetry transaction? | **Yes** | Both call sites (658, 669) sit between `BEGIN` (547) and `COMMIT` (679) on the same client |

---

## Ingestion-impact analysis for THIS change

The incident store is a **new table in the PRIMARY database**, written **only from the alert
worker process** (`alert-workers-main.ts`, its own pool). Mechanisms by which that could still
affect ingestion, and the mitigation applied:

| # | Mechanism | Applies? | Mitigation |
|---|---|---|---|
| 1 | pg-boss contention (`pgboss.job` is in PRIMARY; ingestion's durability boundary commits there) | **Yes, in principle** | Incident writes are *deduplicated by design* — one row per distinct alert identity, not per event. Volume is the same class as `alert_rules`/`connector_configs`, which already live in PRIMARY and are already written by the alerting path. No per-event write is added anywhere. |
| 2 | Shared PRIMARY pool in the API process | Only for API reads | Incident **writes** happen in the alert worker process. The read APIs run in the API process and are ordinary paginated `SELECT`s, bounded by `LIMIT`, same as the existing rules/events endpoints. |
| 3 | `LOG_DB_PRIMARY ?? DATABASE_URL` fallback collapsing DB separation | Environment-dependent | Flagged as a deployment prerequisite, not something this change can fix. Documented in the report's remaining risks. |
| 4 | WAL / checkpoint amplification | Proportional to write volume | Bounded by dedup (mechanism 1). Index count kept deliberately minimal and query-driven. |
| 5 | Autovacuum worker starvation | Proportional to churn | Explicit per-table autovacuum storage parameters set on the new table so it does not rely on global defaults and cannot starve `pgboss.job`'s vacuum. |
| 6 | Lock contention | **No** | Ingestion never reads or writes the new table, so row/table lock conflict is impossible. DDL risk handled by short migrations + `IF NOT EXISTS`. |
| 7 | Replication lag | Indirect | Same bound as mechanism 4. |
| 8 | Shared table | **No** | A genuinely new table. No column, index, or trigger added to any Tier 4 object. |

**Net:** the only residual shared resource is the database instance itself, and incident write
volume is bounded by fingerprint deduplication rather than by telemetry volume.
