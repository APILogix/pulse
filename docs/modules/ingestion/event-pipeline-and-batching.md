# Ingestion Pipeline — How Events Actually Get Inserted

**Question this document answers:** are telemetry events inserted one-by-one or in batches?

**Answer:** **in batches, at every one of the four stages.** No stage performs a per-event database
round trip. For a job of *N* events of one type, the database sees a **fixed** number of statements
— typically 5 — regardless of whether *N* is 1 or 200.

This document traces the path end to end, names the exact statement emitted for each of the ten
event types, and states the one place where 1 event legitimately becomes N rows (trace span trees)
along with the bind-parameter defect that was found and fixed while verifying it.

---

## Table of contents

1. [The four batching stages](#1-the-four-batching-stages)
2. [Stage 1 — HTTP request to pg-boss jobs (gateway)](#2-stage-1--http-request-to-pg-boss-jobs-gateway)
3. [Stage 2 — Job enqueue](#3-stage-2--job-enqueue)
4. [Stage 3 — Job delivery to workers](#4-stage-3--job-delivery-to-workers)
5. [Stage 4 — Database write](#5-stage-4--database-write)
6. [Per-type insert reference (all 10 types)](#6-per-type-insert-reference-all-10-types)
7. [The error path — why it costs more](#7-the-error-path--why-it-costs-more)
8. [Trace span trees — the only 1→N expansion](#8-trace-span-trees--the-only-1n-expansion)
9. [Bind-parameter limit — defect found and fixed](#9-bind-parameter-limit--defect-found-and-fixed)
10. [Statement count per job](#10-statement-count-per-job)
11. [What is NOT in the transaction](#11-what-is-not-in-the-transaction)
12. [Idempotency and duplicate handling](#12-idempotency-and-duplicate-handling)
13. [Tuning reference](#13-tuning-reference)
14. [How to verify this yourself](#14-how-to-verify-this-yourself)

---

## 1. The four batching stages

```
SDK
 │  one HTTP POST carrying up to INGESTION_MAX_BATCH_SIZE (1000) events
 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1 — GATEWAY                          service.ts               │
│   group by event type, then chunk each group by BOTH                │
│     count  ≤ INGESTION_JOB_CHUNK_SIZE (200)                         │
│     bytes  ≤ INGESTION_JOB_MAX_BYTES   (1 MiB)                      │
│   → one pg-boss job per (type, chunk)                               │
└─────────────────────────────────────────────────────────────────────┘
 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2 — ENQUEUE                          ingest-queues.ts         │
│   group jobs by queue → boss.insert(queue, items[])                 │
│   ONE round trip per queue, not per job    ← durability boundary    │
└─────────────────────────────────────────────────────────────────────┘
 ▼
      pgboss.job  (partitioned by queue name, on the PRIMARY DB)
 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 3 — DELIVERY                         worker-registry.ts       │
│   10 queues × localConcurrency(2) × batchSize(4)                    │
│   handler receives an ARRAY of up to 4 jobs → Promise.all           │
│   each job gets its own transaction (independent retry)             │
└─────────────────────────────────────────────────────────────────────┘
 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 4 — DB WRITE                         telemetry-writer.ts      │
│   BEGIN                                                             │
│   SET LOCAL (one round trip, statements joined)                     │
│   group events by type → ONE multi-row INSERT per type              │
│   ONE UNNEST insert into telemetry_outbox                           │
│   COMMIT                                                            │
└─────────────────────────────────────────────────────────────────────┘
 ▼
      LOG DB (partitioned events_* tables)
```

**The key property:** at stage 4, database work scales with the number of **distinct event types**
in the job, not the number of events. Since stage 1 already split by type, a job contains exactly
one type — so it is one INSERT.

---

## 2. Stage 1 — HTTP request to pg-boss jobs (gateway)

`src/modules/ingestion/service.ts`

The gateway does the minimum work required to make events durable, then returns. It performs
**no** telemetry writes.

1. Envelope validation, API-key resolution (LRU-cached), dual rate limiting (org + project).
2. Basic per-event validation only — object shape, known SDK type, size cap. Full Zod
   normalization runs worker-side, never here.
3. Group accepted events by type.
4. Chunk each group on **two** simultaneous bounds:

```ts
if (chunk.length > 0 && (chunk.length >= this.jobChunkSize || chunkBytes + item.bytes > this.jobMaxBytes)) {
  jobs.push(this.buildJob(params, type, chunk));
  chunk = []; chunkBytes = 0;
}
chunk.push(item.raw);
chunkBytes += item.bytes;
```

The byte bound matters as much as the count bound: 200 replay or profile events can be far larger
than 200 metric events, and an oversized job means an oversized worker transaction holding a
connection longer.

**Request-level cap:** `INGESTION_MAX_BATCH_SIZE` (1000). Exceeding it rejects the request with
`BATCH_TOO_LARGE` — it does not silently truncate.

### Worked example

A single POST with 450 events — 300 requests, 100 logs, 50 traces — produces:

| Type | Events | Jobs | Why |
|---|---|---|---|
| request | 300 | 2 | 200 + 100 (count bound) |
| log | 100 | 1 | under both bounds |
| trace | 50 | 1–3 | depends on payload bytes |

So ~4–6 jobs, not 450.

---

## 3. Stage 2 — Job enqueue

`src/modules/ingestion/queue/ingest-queues.ts` → `enqueueIngestJobs()`

Jobs are grouped by queue and inserted with pg-boss v12's bulk API — **one** round trip per queue:

```ts
const ids = await boss.insert(queue, items);   // items = [{ data, priority }, ...]
```

If `boss.insert` throws, it falls back to per-job `pgboss.send()` and records
`{ bulk: false, fallback: true }` so the degradation is visible in logs rather than silent.

**This is the durability boundary.** Once `enqueueIngestJobs` resolves, the events survive a crash
of any process. It is the only hard work the gateway is permitted to do.

Job priority is computed per job — `PLAN_WEIGHT[tier] + TYPE_URGENCY[type] + deferCount × 25` — so
enterprise errors outrank free-tier profiles in the queue.

---

## 4. Stage 3 — Job delivery to workers

`src/modules/ingestion/workers/worker-registry.ts`

One dedicated pg-boss worker per event type, so a slow profile upload can never block error
ingestion:

```ts
await pgboss.work(queue, {
  localConcurrency: env.INGESTION_TYPE_WORKER_CONCURRENCY,  // 2
  batchSize:        env.INGESTION_TYPE_WORKER_BATCH_SIZE,   // 4
  perJobResults: true,
  includeMetadata: true,
}, handler);
```

The handler receives an **array** of up to 4 jobs and fans them out with `Promise.all`, each through
`runOne()`.

**Batching at this layer is about delivery, not about the DB transaction.** Each job still gets its
own `BEGIN`/`COMMIT`. That is deliberate: `perJobResults: true` lets pg-boss settle each job
individually, so one poisoned job is retried alone instead of dragging its three batchmates into
retry with it.

Two gates run before any DB connection is acquired:

- **Tenant fairness** — per-org in-flight budget (`TENANT_INFLIGHT_LIMIT`). Over-budget jobs are
  re-enqueued with `deferCount + 1` and an aged priority boost; the original completes without
  processing. A deferral costs one `pgboss.job` insert and zero telemetry connections.
- **Write admission** — a FIFO semaphore bounding concurrent ingest transactions to the telemetry
  pool's real capacity. See [the forensics doc](../../ingestion-performance-forensics.md).

---

## 5. Stage 4 — Database write

`src/modules/ingestion/pipeline/telemetry-writer.ts`, driven by
`src/modules/ingestion/workers/event-processor.ts`

One transaction per job:

```
BEGIN
SET LOCAL synchronous_commit = on;
  SET LOCAL lock_timeout = '2000ms';
  SET LOCAL statement_timeout = '60000ms';
  SET LOCAL idle_in_transaction_session_timeout = '30000ms'   ← ONE round trip (joined with '; ')
<one multi-row INSERT per event type>
<one UNNEST insert into telemetry_outbox>
COMMIT
```

Events are grouped by type, then dispatched once per type:

```ts
const byType = new Map<string, ScopedEvent[]>();
for (const s of scoped) { /* group */ }

for (const [type, list] of byType) {
  const res = await this.writeTyped(type, list, db);   // ← ONE call per TYPE, not per event
}
```

`writeTyped` is a flat switch over the ten types, each handing its whole `list` to a writer that
builds a single statement via `buildInsert`:

```ts
function buildInsert(table, cols, rows, returning?) {
  // rows -> ($1, $2, ...), ($n, $n+1, ...), ...
  return {
    text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING${returningClause}`,
    values,
  };
}
```

Every writer follows the same shape — `list.map(...)` to build rows in memory, then **one**
`db.query`. There is no `await` inside any row-building loop.

---

## 6. Per-type insert reference (all 10 types)

Verified by reading each writer. All ten are set-based.

| Event type | Table | Rows per event | Statements per batch | Writer |
|---|---|---|---|---|
| `error` | `events_errors` | 1 | 1 (+ grouping, see §7) | `writeErrors` |
| `message` | `events_messages` | 1 | **1** | `writeMessages` |
| `request` | `events_requests` | 1 | **1** | `writeRequests` |
| `span` | `events_spans` | 1 | **1** | `writeSpans` |
| `trace` | `events_traces` **+** `events_spans` | 1 + N spans | **2** (span insert chunked if needed) | `writeTraces` → `writeTraceSpanTree` |
| `metric` | `events_metrics` | 1 | **1** | `writeMetrics` |
| `log` | `events_logs` | 1 | **1** | `writeLogs` |
| `profile` | `events_profiles` | 1 | **1** | `writeProfiles` |
| `cron_checkin` | `events_cron_checkins` | 1 | **1** | `writeCronCheckins` |
| `replay` | `events_replays` | 1 | **1** | `writeReplays` |

Notes that affect row width:

- `events_requests` — `is_slow` and `is_error` are `GENERATED` columns and are deliberately **not**
  inserted; `created_at` / `ingested_at` rely on `DEFAULT NOW()`.
- `events_errors` — 41 columns. `error_group_id` is inserted as `NULL` and back-filled by a single
  set-based `UPDATE` (see §7).
- `events_spans` — **67 columns**, the widest table in the pipeline. This matters for §9.
- `events_traces` — 39 columns, including `spans_tree` as raw JSONB alongside the flattened rows.

---

## 7. The error path — why it costs more

Errors are the only type that needs read-modify-write, because each event must be attached to an
`error_groups` row whose `occurrence_count`, `first_seen_at` / `last_seen_at` and regression state
have to be updated.

It is still **fully set-based**. `ErrorIngestionService.ingestBatch()` performs:

1. **One** multi-row `INSERT INTO events_errors ... ON CONFLICT DO NOTHING RETURNING` — duplicates
   are detected by diffing the returned rows in memory, with no pre-`SELECT`.
2. Grouping via `upsertGroupsBatch()`, which first **aggregates by `(project_id, fingerprint)` in
   memory**, so the SQL scales with *U* (unique fingerprints) rather than *N* (events):
   - `SELECT ... ORDER BY g.project_id, g.fingerprint FOR UPDATE OF g` — lock existing groups
     (the `ORDER BY` gives every worker one global lock order, preventing deadlocks)
   - `INSERT INTO error_groups ... ON CONFLICT DO NOTHING` — create new groups, seeded with the
     pre-aggregated in-batch count
   - `UPDATE error_groups AS g ... FROM (VALUES ...)` — bulk occurrence-count and snapshot update
   - `SELECT g.*` — read back
   - conditional: history rows, regression outbox
3. **One** set-based `UPDATE events_errors ... FROM (VALUES ...)` to attach group ids.

### Query count is constant in N

```
Q = 4                           BEGIN, SET LOCAL, INSERT events_errors, COMMIT
  + 2                           group lock SELECT + read-back SELECT
  + [1 if new fingerprints]     INSERT error_groups
  + [1 if lost conflict race]   re-lock SELECT
  + [1 if existing fingerprints]UPDATE error_groups
  + [1 if groups created]       INSERT error_group_history
  + [2 if regression]           history + regression outbox
  + [1 if anything inserted]    UPDATE events_errors (attach)
  + [1 if anything inserted]    telemetry_outbox
```

**N does not appear.** It only changes the number of `VALUES` tuples inside individual statements.

| Scenario | Queries |
|---|---|
| all duplicates | 4 |
| N errors, existing fingerprints | **9** |
| N errors, all-new fingerprints | 10 |
| mixed | 11 |
| + regression | 14 (max) |

> **The one remaining O(N) path.** If a matched group has `merged_into` set, the set-based statement
> cannot follow the merge chain and falls back to per-event resolution — roughly `3N + 7` queries.
> It is instrumented: `ingest_error_group_merge_fallback_total`. If that counter is anything but
> rare, merge-chain resolution needs to move into the set-based statement.

---

## 8. Trace span trees — the only 1→N expansion

Every other type is 1 event → 1 row. Traces are the exception: a trace arrives with a nested
`rootSpan` tree, and each span becomes a row in `events_spans`.

The recursion is **in-memory only**:

```ts
private async writeTraceSpanTree(list: ScopedEvent[], db: Queryable): Promise<void> {
  const rows: unknown[][] = [];
  for (const scoped of list) {
    this.collectTraceSpanRows(scoped, e.rootSpan, null, 0, ts, rows);   // recursive, CPU only
  }
  if (rows.length === 0) return;
  await insertChunked(db, 'events_spans', [...67 columns...], rows);     // set-based
}
```

`collectTraceSpanRows` walks `children` depth-first, accumulating into a shared `rows` array. **No
database call happens inside the recursion.**

So a batch of 4 traces with 3 child spans each = 16 span rows in **one** INSERT, not 16 inserts.
A single trace with 500 spans = 501 rows in **one** INSERT.

Depth and breadth are unbounded in the writer. The upstream bound is
`LIMITS.maxTraceSpanCount` = 10,000, validated against the SDK-declared `spanCount` field. Note
that `normalizeTraceSpanTimestamps`'s `remaining` budget only stops *timestamp normalization*
recursion — it does not truncate the tree.

---

## 9. Bind-parameter limit — defect found and fixed

> **Status: fixed.** Documented because it is the one place where "batch everything into a single
> statement" was taken too far, and because the failure mode is instructive.

### The problem

PostgreSQL's wire protocol encodes the bind-parameter count as a signed 16-bit integer, so a single
statement carries at most **65,535 parameters**. Exceeding it is not a slow query — the statement is
**rejected**.

`events_spans` has **67 columns**, so:

```
max span rows per statement = floor(65535 / 67) = 978
```

`writeTraceSpanTree` previously emitted **one unbounded INSERT**. That was reachable with entirely
ordinary traffic:

| Scenario | Span rows | Params | Result |
|---|---|---|---|
| 1 trace × 978 spans | 978 | 65,526 | at the edge |
| **200 traces × 5 spans** | **1,000** | **67,000** | ❌ rejected |
| 1 trace × 2,000 spans (allowed: 10,000) | 2,000 | 134,000 | ❌ rejected |

Five spans per trace is the *point* of distributed tracing, so the 200-trace case was realistic.
The consequence was a rejected statement → failed job → three retries burned → dead-lettered batch
→ traces lost.

The 1 MiB `INGESTION_JOB_MAX_BYTES` cap reduced but did not remove the exposure: spans are compact
in JSON yet expand to 67 columns each, so a 1 MiB job can easily carry well over 978 spans.

### The fix

A new `insertChunked()` helper splits by parameter budget, keeping the single-statement fast path
for the common case:

```ts
const PG_MAX_BIND_PARAMS = 65535;

async function insertChunked(db, table, cols, rows) {
  if (rows.length === 0) return 0;
  const maxRowsPerStatement = Math.max(1, Math.floor(PG_MAX_BIND_PARAMS / cols.length));

  if (rows.length <= maxRowsPerStatement) {        // common case: one statement
    const { text, values } = buildInsert(table, cols, rows);
    return (await db.query(text, values)).rowCount ?? 0;
  }

  let inserted = 0;                                // oversized: split
  for (let offset = 0; offset < rows.length; offset += maxRowsPerStatement) {
    const { text, values } = buildInsert(table, cols, rows.slice(offset, offset + maxRowsPerStatement));
    inserted += (await db.query(text, values)).rowCount ?? 0;
  }
  return inserted;
}
```

Applied to `writeTraceSpanTree`, the only 1→N writer. Chunks run inside the caller's existing
transaction, so atomicity is unchanged — either all chunks commit or the transaction rolls back.

### Headroom for the 1→1 types

The other nine types cannot reach the limit at current settings:

```
200 events (INGESTION_JOB_CHUNK_SIZE) × 67 columns (widest) = 13,400 params
65,535 / 13,400 ≈ 4.9× headroom
```

`INGESTION_JOB_CHUNK_SIZE` would have to exceed ~978 before a 1→1 type became at risk. Its
validated maximum is 1000, so if you ever raise it toward that ceiling, route the remaining writers
through `insertChunked` too.

### Regression tests

`src/modules/ingestion/pipeline/telemetry-writer.test.ts` (6 tests):

- 50 log events → exactly **1** INSERT with 50 tuples
- every INSERT carries `ON CONFLICT DO NOTHING`
- 4 traces × 3 children → 1 trace INSERT + 1 span INSERT with 16 tuples
- **2 traces × 799 children (1,600 rows) → chunked, every chunk ≤ 65,535 params, zero rows lost**
- 1 trace × 500 children (501 rows) → still a single statement
- mixed batch → one INSERT per type, not per event

---

## 10. Statement count per job

Measured by `instrumentClientQueries()`, which counts **round trips** — so the four `SET LOCAL`
statements register as 1.

| Job type | Statements | Breakdown |
|---|---|---|
| Any 1→1 type (log, metric, request, span, message, profile, replay, cron_checkin) | **5** | BEGIN, SET LOCAL, INSERT, outbox, COMMIT |
| Trace | **6** | BEGIN, SET LOCAL, INSERT traces, INSERT spans, outbox, COMMIT |
| Trace with >978 spans | 6 + extra chunks | as above, span insert split |
| Error | **9** typical, 14 max | see §7 |

**A job of 200 log events costs 5 statements. A job of 1 log event also costs 5.** That is the
entire design goal.

---

## 11. What is NOT in the transaction

Deliberately excluded to keep connection hold time short:

| Work | Where it runs | Why |
|---|---|---|
| Usage/billing accounting | `UsageCounter`, in-memory buffer flushed on a timer (`INGESTION_USAGE_FLUSH_MS` = 30s) to `usage_counter_staging` | Never blocks ingestion; the rollup cron is the sole rollup driver |
| Domain events | after `COMMIT`, in-process `EventEmitter` | No events emitted for a rolled-back batch |
| Alert evaluation | reads `telemetry_outbox` asynchronously | The outbox row *is* the handoff |
| Analytics rollups | separate event-analytics worker | Never written on the ingest path |
| Normalization / validation / fingerprinting | pure CPU, before `BEGIN` | Nothing that can be done outside a transaction happens inside one |

**Inside** the transaction: the typed event INSERT, error grouping (errors only), and the
`telemetry_outbox` insert. The outbox must be transactional — an event that is persisted but never
produces an alert would be a correctness bug.

The outbox insert is `UNNEST`-based, so its bind-parameter count is **fixed at 9 regardless of batch
size**:

```sql
WITH input AS (
  SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[],
                       $6::logdb_severity[], $7::boolean[], $8::jsonb[], $9::timestamptz[])
    AS t(organization_id, project_id, environment, signal_kind, event_id,
         severity, fast_path, attributes, occurred_at)
), reserved AS ( INSERT INTO alert_runtime_idempotency_keys ... ON CONFLICT DO NOTHING RETURNING ... )
INSERT INTO telemetry_outbox (...) SELECT ... FROM input JOIN reserved ... ON CONFLICT DO NOTHING
```

---

## 12. Idempotency and duplicate handling

pg-boss is at-least-once: a job can be delivered more than once after a retry, expiry or crash.
Every insert is therefore idempotent.

- **Mechanism:** `ON CONFLICT DO NOTHING` with no column target, resolved against the
  `(organization_id, event_id, occurred_at)` identity indexes. That unique index *is* the
  deduplication mechanism — it is required for correctness, not merely for read performance.
- **Detection:** `rowCount` from the INSERT is the true inserted count, so duplicates are detected
  with **no extra query**. Where the identity of inserted rows is needed (errors), `RETURNING` is
  used and diffed in memory. Hot-path inserts avoid `RETURNING` entirely.
- **Billing:** only rows actually inserted are billed, so retries are never double-charged.
- **Outbox:** receives only events the database confirmed inserted. Previously the whole received
  array was passed, so a batch of 1 new + 99 duplicates built a 100-row payload whose 99 extra
  idempotency-key inserts were guaranteed to be discarded — pure write amplification on the retry
  path, i.e. exactly when the system is already stressed.

A fully duplicate batch therefore costs 4 statements and writes nothing.

---

## 13. Tuning reference

| Setting | Default | Governs |
|---|---|---|
| `INGESTION_MAX_BATCH_SIZE` | 1000 | Max events per HTTP request (gateway rejects above) |
| `INGESTION_JOB_CHUNK_SIZE` | 200 | Max events per pg-boss job (count bound) |
| `INGESTION_JOB_MAX_BYTES` | 1 MiB | Max events per pg-boss job (byte bound) |
| `INGESTION_TYPE_WORKER_CONCURRENCY` | 2 | Concurrent handler invocations per queue |
| `INGESTION_TYPE_WORKER_BATCH_SIZE` | 4 | Jobs delivered per handler invocation |
| `INGESTION_WRITE_CONCURRENCY` | 16 | Concurrent ingest transactions (admission permits) |
| `INGESTION_WRITE_POOL_SIZE` | 20 | Dedicated telemetry write pool |
| `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` | 60000 | Per-transaction statement timeout |
| `LIMITS.maxTraceSpanCount` | 10000 | Declared `spanCount` ceiling (normalizer) |
| `PG_MAX_BIND_PARAMS` | 65535 | Hard protocol limit — not configurable |

**Total in-flight jobs** = 10 queues × concurrency × batchSize = 80 at defaults. This bounds
resident memory (80 × 1 MiB ≈ 80 MB against a 512 MB heap), and is separate from database
concurrency, which the admission semaphore bounds independently.

Raising batch size is not automatically faster. Larger transactions hold connections longer, hold
locks longer, and inflate tail latency. See
[the forensics doc](../../ingestion-performance-forensics.md) §13 for the measurement procedure.

---

## 14. How to verify this yourself

Every claim here is checkable.

**Statement count per batch** — the worker logs an `ingestion batch profile` line per job with
`dbQueries`, `dbQueryMs`, `insertMs`, `outboxMs`, `commitMs`, `transactionMs`,
`writeAdmissionWaitMs` and `outboxRowsSkippedDuplicate`. Send 1 event, then 200, and compare
`dbQueries` — it should not change.

**Live SQL** — the shape is visible directly:

```sql
SELECT query, calls, rows, mean_exec_time
  FROM pg_stat_statements
 WHERE query LIKE 'INSERT INTO events_%'
 ORDER BY calls DESC;
```

Multi-row inserts appear as one normalized entry with `rows` ≫ `calls`. If you see `calls` scaling
with event count and `rows ≈ calls`, something has regressed to per-event inserts.

**Test suite:**

```bash
npx vitest run src/modules/ingestion src/modules/errors
```

**Benchmarks** (require a populated database):

```bash
npm run bench:ingestion:matrix     # 10 / 100 / 500 / 1k / 10k events
npm run explain:ingestion          # EXPLAIN on the write path
```

---

## Summary

| Question | Answer |
|---|---|
| One-by-one or batched? | **Batched at all four stages.** No per-event DB round trip anywhere. |
| Statements for 200 same-type events? | **5** (6 for traces, 9 for errors) |
| Statements for 1 event? | **The same** — the count is independent of N |
| Any per-event DB loop? | One: the error merged-group fallback, instrumented and rare |
| Any 1→N row expansion? | Traces only — span tree flattened in memory, inserted set-based |
| Idempotent? | Yes — `ON CONFLICT DO NOTHING` on the identity indexes |
| Anything blocking in the transaction? | No — usage, domain events, alerts and rollups are all outside |

---

## Related documents

- [Ingestion Pipeline Performance Forensics](../../ingestion-performance-forensics.md) — root-cause
  analysis, write-admission design, bottleneck ranking
- [Scaling & Neon Plan Upgrade Runbook](../../deployment/scaling-and-plan-upgrade-runbook.md) —
  pool inventory and per-process scaling constraints
- [Ingestion Module Architecture](./architecture.md) · [Working](./working.md) ·
  [Benchmark](./benchmark.md)
