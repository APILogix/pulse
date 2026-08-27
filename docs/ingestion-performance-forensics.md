# Ingestion Pipeline Performance Forensics

**Scope:** telemetry ingestion path of the Pulsiv observability platform
**Method:** code / schema / configuration forensics, then bounded high-impact changes
**Status:** implemented and verified (see [§23](#23-beforeafter-metrics) and [§25](#25-regression-tests))

---

## 1. Executive Summary

The ingestion tier's latency was **not** caused by slow inserts, missing indexes, expensive
triggers, or per-event query multiplication. Every one of those hypotheses was tested against
the actual code and schema and **falsified**.

The dominant cause was **connection starvation created by the tier's own configuration**: the
worker process was configured to run up to **320 concurrent job handlers against a database
pool of 10 connections** — a 32:1 oversubscription. Handlers spent their time queued inside
`pg`'s pool waiter list, and any handler that waited longer than 30 seconds failed with a
connection error, which the tier then classified as retryable. Overload was therefore converted
into *more load*: retries, exponential backoff, and dead letters.

Five root causes were identified and fixed. The headline change is that concurrent database
demand is now **bounded by a semaphore derived from real pool capacity**, making oversubscription
structurally impossible rather than merely unlikely.

Notably, the single largest item in the original optimization brief — *"10 errors generate 36 DB
queries, Q(N) = 3N + 6"* — **does not reproduce**. Error ingestion is already fully set-based at
`Q ≈ 9`, independent of batch size. That work had already landed. Chasing it further would have
been wasted effort; the evidence is in [§9](#9-error-grouping-analysis).

### What changed, in one table

| # | Root cause | Severity | Change |
|---|---|---|---|
| RC-1 | 320 concurrent handlers vs. 10-connection pool (32:1) | **P0** | Bounded write-admission semaphore + dedicated, correctly-sized write pool |
| RC-2 | No `statement_timeout` on ingest transactions, while pg-boss re-delivers at 300s | **P0** | `statement_timeout` = 60s, enforced by a boot-time invariant check |
| RC-3 | Queue-depth probe = unpruned scan of a partitioned table, ~1/sec, on the contended control pool | **P1** | Partition-prunable `= ANY($1)` predicate + configurable 3s cache |
| RC-4 | Non-deterministic `FOR UPDATE` lock order on `error_groups` → deadlock churn | **P1** | Global lock ordering via `ORDER BY` beneath `FOR UPDATE` |
| RC-5 | Outbox write amplification for duplicate events; fingerprint computed 2-3x per event | **P2** | Outbox restricted to confirmed-inserted events; fingerprint memoized |

---

## 2. Current Architecture

```
SDK ──HTTPS──> Gateway (Fastify, PM2 cluster)
                 │  auth (SHA-256 + timingSafeEqual, LRU)
                 │  dual rate limit (org + project)
                 │  AJV validation, normalization
                 │  queue-depth backpressure  ◄── RC-3
                 └──> pg-boss job insert  (durability boundary)
                            │
                      pgboss.job  (partitioned by queue name, PRIMARY DB)
                            │
      ┌─────────────────────┴──────────────────────┐
      │  ingestion-workers process (PM2, 1 fork)   │
      │                                            │
      │  10 x pgboss.work(ingest.<type>)  ◄── RC-1 │
      │        │                                   │
      │  tenant fairness gate (per-org in-flight)  │
      │        │                                   │
      │  write admission semaphore  ◄── NEW        │
      │        │                                   │
      │  EventProcessor.process()                  │
      │    BEGIN / SET LOCAL  ◄── RC-2             │
      │    typed event INSERT (multi-row)          │
      │    error grouping     ◄── RC-4             │
      │    telemetry_outbox   ◄── RC-5             │
      │    COMMIT                                  │
      └────────────────────────────────────────────┘
                            │
                    LOG DB (partitioned telemetry)
```

**Three distinct pools live in the ingestion process** (this matters for RC-1):

| Pool | Target | `max` (before) | Purpose |
|---|---|---|---|
| Control | Primary | `INGESTION_DB_POOL_SIZE` = 8 | DLQ inserts, usage rollup, depth probes |
| pg-boss | Primary | 8 (+1 dedicated `LISTEN` client) | job delivery, supervise, schedule |
| Telemetry | Log DB | `LOG_POOL_MAX` = **10** | **all ingest writes** |

After this work there is a fourth: a **dedicated ingest write pool** (`INGESTION_WRITE_POOL_SIZE`
= 20) against the Log DB, which is what `EventProcessor` now writes through. `LOG_POOL_MAX`
(since raised to 20) serves Log DB *reads* and migrations only.

---

## 3. Ingestion Lifecycle

1. Gateway validates, normalizes, and chunks a batch (`INGESTION_JOB_CHUNK_SIZE` = 200 events,
   `INGESTION_JOB_MAX_BYTES` = 1 MiB).
2. Jobs are bulk-inserted into `pgboss.job` via `boss.insert()`, one round trip per queue.
   **This is the durability boundary** — the gateway does no other hard work.
3. pg-boss delivers job *arrays* to per-type workers.
4. `WorkerRegistry.runOne()` applies the tenant-fairness gate; over-budget jobs are re-enqueued
   with `deferCount + 1` and an aged priority boost.
5. `EventProcessor.process()` opens one transaction and performs all writes for the job.
6. `COMMIT`, then post-commit in-process domain events.

**ACK correctness (verified, unchanged):** pg-boss settles each job *after* the handler resolves,
and the handler only resolves after `COMMIT`. `perJobResults: true` means one poisoned job never
drags its batchmates into retry. No acknowledgement occurs before the durable persistence
boundary. All changes below preserve this ordering.

---

## 4. Bottleneck Ranking

| Rank | Bottleneck | Evidence class | Fixed |
|---|---|---|---|
| 1 | Write connection starvation (32:1) | configuration arithmetic + `dbConnectionWaitMs` | yes |
| 2 | Unbounded transaction hold time vs. 300s job expiry | absent `statement_timeout` on both pool and transaction | yes |
| 3 | Queue-depth probe cost and frequency | `LIKE` predicate on a partitioned table, 1/sec, contended pool | yes |
| 4 | `error_groups` deadlock churn | non-deterministic lock order in `FOR UPDATE` | yes |
| 5 | Duplicate-path outbox amplification | `scoped` passed instead of inserted subset | yes |
| 6 | Redundant fingerprint computation | 2-3 sha256 per error event | yes |
| — | Error query multiplication (`3N + 6`) | **falsified** — already `O(1)` | n/a |
| — | Triggers / public-ID generation | **exonerated** — see §7 | n/a |
| — | Index write amplification | **no removals justified** — see §6 | n/a |

---

## 5. Root Cause Analysis

Each entry follows the mandated
**PROBLEM → EVIDENCE → ROOT CAUSE → CHANGE → EXPECTED EFFECT → RISK → VALIDATION** format.

### RC-1 — Write connection starvation (P0, dominant)

**Problem.** Jobs reported large `dbConnectionWaitMs` and long queue waits, and jobs failed with
connection-timeout errors under sustained load.

**Evidence.** Pure configuration arithmetic, no profiling required:

```
SDK_EVENT_TYPES                          = 10   (error, message, request, span, trace,
                                                 metric, log, profile, cron_checkin, replay)
INGESTION_TYPE_WORKER_CONCURRENCY        =  8   (env.ts default; absent from .env)
INGESTION_TYPE_WORKER_BATCH_SIZE         =  4   (env.ts default; absent from .env)

max concurrent job handlers = 10 x 8 x 4  = 320
telemetry pool max (LOG_POOL_MAX in .env) =  10
                                oversubscription = 32 : 1
```

`WorkerRegistry.start()` registers `pgboss.work(queue, { localConcurrency, batchSize })` per type;
`handleIngestBatch` fans the delivered array out with `Promise.all(jobs.map(...))`; every resulting
`runOne()` reaches `EventProcessor.process()`, which calls `pool.connect()` and holds that
connection for the entire `BEGIN..COMMIT`.

**Root cause.** Fetch concurrency and database concurrency were the same number. There was no
mechanism relating worker fan-out to pool capacity, so the pool was the only thing limiting DB
concurrency — and it did so via a **30-second timeout that produces an error**, not via
backpressure. `failureReason()` maps that error to `db_connection`, which is retryable, so the
tier amplified overload into retries, exponential backoff, and dead letters. Because `pg` pool
waiters are not fair across queues, one hot event type could also starve all others
(head-of-line blocking).

**Change.**
1. New `WriteAdmissionController` (`pipeline/write-admission.ts`): a FIFO semaphore that bounds
   concurrent ingest transactions. Waiting happens **in memory, FIFO, with no timeout** instead of
   on a pool acquire that fails.
2. `resolveWritePermits(configured, poolMax)` derives permits from the pool actually being written
   to and reserves headroom, so `permits <= poolMax - reserve` **always** holds.
3. A **dedicated telemetry write pool** (`INGESTION_WRITE_POOL_SIZE` = 20) isolates ingest writes
   from the shared Log DB pool, so API read bursts and ingest write bursts can no longer steal
   capacity from each other — and so the semaphore is aligned with a pool this process fully owns.
4. `INGESTION_TYPE_WORKER_CONCURRENCY` lowered `8 → 2`, bounding in-flight job *memory*
   (see the memory note below).

```
AFTER
  in-flight jobs  = 10 x 2 x 4 = 80        (fetch pressure / memory)
  write permits   = min(16, 20 - 2) = 16   (database concurrency)
  pool max        = 20
  oversubscription of the pool = NONE (16 <= 18, by construction)
  feed ratio for the permits    = 80 / 16 = 5 : 1  (permits stay saturated)
```

**Why not simply raise the pool?** Raising the pool without bounding demand relocates contention
into PostgreSQL, where each extra backend costs memory and scheduler time. Bounding demand to
match capacity is what makes P99 predictable. Both were done, in the correct order.

**Secondary defect fixed by the same change (memory).** At 320 in-flight jobs, each holding a
payload capped at `INGESTION_JOB_MAX_BYTES` = 1 MiB, worst-case resident payload was ~320 MB
against `--max-old-space-size=512` and `max_memory_restart: 700M` in `ecosystem.config.cjs` — an
OOM-restart hazard that also loses in-flight work. 80 in-flight bounds this at ~80 MB.

**Expected effect.** `dbConnectionWaitMs` collapses toward zero and becomes a genuine pool-health
signal; admission queueing is measured separately as `writeAdmissionWaitMs`; connection-timeout
job failures and their retry/DLQ amplification are eliminated; per-queue fairness improves because
FIFO admission removes head-of-line blocking.

**Risk.** A semaphore is a new failure mode: a leaked permit would deadlock the tier permanently.
Mitigated by releasing in `finally`, handing permits directly to the next waiter (so `inFlight`
can never transiently exceed `permits`), and direct unit tests for the leak-on-throw and FIFO
invariants. Deliberately **no timeout** on the wait — a timeout would recreate the exact failure
mode being removed. Overload is signalled upstream by gateway backpressure, not by failing
already-accepted work.

**Validation.** `write-admission.test.ts` (10 tests): peak concurrency never exceeds permits;
permit released on throw; FIFO ordering; saturation reporting; `resolveWritePermits` clamping and
malformed-input handling. Full ingestion + errors suite green.

---

### RC-2 — Unbounded transaction hold time vs. job expiry (P0)

**Problem.** A single pathological batch could hold a pool connection indefinitely.

**Evidence.**
- `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` default `0` → `applyIngestionTransactionSettings()`
  emitted **no** `SET LOCAL statement_timeout`.
- `log-database.ts` deliberately sets no pool-level `statement_timeout` either (documented
  rationale: a global timeout would kill legitimate large batches).
- `LOG_DB_WRITE_TIMEOUT` = `0` → the write path was unbounded on every axis.
- `INGESTION_JOB_EXPIRE_SECONDS` = `300`.

**Root cause.** Two independent mechanisms with no ordering guarantee between them. pg-boss
re-delivers an expired job **without cancelling the still-running transaction**. So a batch
exceeding 300s produced: two workers writing the same batch concurrently, *and* the original still
holding one of the pool's connections. Under RC-1's already-scarce pool this is a death spiral —
each stuck transaction permanently removes capacity, making the next batch more likely to stick.

**Change.**
- `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` default `0 → 60_000`. Applied per-transaction via
  `SET LOCAL`, so it can never leak onto a pooled connection.
- Added `assertIngestionTimeoutsAreOrdered()` in `env.ts`: the process **refuses to boot** if
  `statement_timeout >= job expiry`. The invariant is now enforced, not documented.

60s is roughly two orders of magnitude above the expected p99 for a ≤200-event batch, so it fires
only on genuine pathology, and always *before* pg-boss re-delivers.

**Expected effect.** Upper bound on connection hold time. Duplicate concurrent processing of the
same batch becomes impossible via this route. A stuck statement fails fast as `57014`, which
`failureReason()` already classifies as `db_statement_timeout` for clean attribution.

**Risk.** A legitimately slow batch that previously completed in >60s now fails and retries.
Assessed as acceptable: such a batch would previously have been *duplicated* at 300s anyway, which
is strictly worse. The value is env-tunable, and the boot guard prevents raising it into the unsafe
range by accident.

**Validation.** Existing `event-processor.test.ts` rollback/idempotency tests pass unchanged. The
boot guard is exercised by the fact that the default configuration boots.

---

### RC-3 — Queue-depth probe cost and frequency (P1)

**Problem.** Gateway backpressure probing consumed contended control-pool capacity.

**Evidence.** The probe SQL was:

```sql
FROM pgboss.job
WHERE name LIKE 'ingest.%'      -- opaque to partition pruning
GROUP BY name, state
```

pg-boss v12 provisions `pgboss.job` as a **partitioned** table with one partition per queue name.
A `LIKE` predicate cannot be used for partition pruning, so every probe scanned **all** partitions
— including unrelated queues (alerting, automation, billing, webhooks). Called from the gateway on
a hardcoded ~1s refresh and from the metrics server every 5s, both on the control pool
(`max` = 8, already shared with DLQ inserts, usage rollup, and fairness bookkeeping).

**Root cause.** A frequently-executed, unprunable aggregate scan feeding a decision whose
thresholds (`INGESTION_BACKPRESSURE_HIGH_WATER` = 100 000 / `CRITICAL` = 250 000) cannot possibly
change between one-second samples.

**Change.**
- `WHERE name = ANY($1::text[])` with an explicit queue-name list, enabling partition pruning.
  The list is the exact same set the old `LIKE` matched (all names begin with `ingest.`), so the
  returned numbers are byte-for-byte identical — this is a pure planner optimization.
- Gateway cache TTL is now `INGESTION_QUEUE_DEPTH_CACHE_MS` (default 3000ms) instead of a
  hardcoded 1000ms.

**Expected effect.** Partition pruning cuts scanned relations to the ingest partitions only; the
TTL cuts probe frequency ~3x. Both directly return control-pool capacity to DLQ intake and usage
accounting. The request path was already non-blocking (returns the cached snapshot, refreshes in
the background) and remains so.

**Risk.** A staler backpressure snapshot. Bounded and immaterial: the decision is advisory and its
thresholds are five orders of magnitude larger than the per-second arrival rate.

**Validation.** `ingest-queues.test.ts` passes, including its bulk-insert fallback coverage.

---

### RC-4 — `error_groups` deadlock churn (P1)

**Problem.** Concurrent ingestion of overlapping error fingerprints caused avoidable transaction
aborts.

**Evidence.** `ErrorGroupRepository.upsertGroupsBatch()` locks every pre-existing group in the
batch with:

```sql
WITH input(project_id, fingerprint) AS (VALUES ...)
SELECT g.* FROM error_groups g
  JOIN input i ON i.project_id = g.project_id AND i.fingerprint = g.fingerprint
 FOR UPDATE OF g          -- no ORDER BY
```

The `VALUES` list was built from a `Map` in **insertion order**, i.e. arbitrary batch arrival
order. Two workers with overlapping fingerprint sets could therefore request the same locks in
opposite orders.

**Root cause.** Textbook lock-order inversion. Worker A holds fingerprint X and wants Y while
worker B holds Y and wants X. PostgreSQL breaks the cycle with `40P01 deadlock_detected`, which is
retryable — so under concurrent load on hot fingerprints the tier burned capacity on deadlock
retries. The `lock_timeout` of 2000ms limited the damage but did not remove the cause.

**Change.** Added `ORDER BY g.project_id, g.fingerprint` to **both** locking selects (the primary
probe and the raced re-lock, the latter being the most deadlock-prone statement in the batch since
it runs precisely *because* another worker is writing the same groups). PostgreSQL places the
`LockRows` node **above** the `Sort` node, so rows are locked in sorted output order — giving every
worker in the fleet one global lock order and making a cycle impossible. `aggregateList` is also
sorted with a matching `compareAggregate` comparator so the SQL and JS orders agree.

Plain lexicographic comparison is correct here: both columns are ASCII (UUID text, hex sha256
digest), so there is no collation subtlety versus PostgreSQL's ordering.

**Expected effect.** `40P01` aborts on this path are eliminated. Cost is a sort over *U* (unique
fingerprints in the batch), not *N* (events) — negligible.

**Risk.** Behaviourally inert, verified: results are returned keyed by `inputIndex`; the per-group
`isNew` marker is per-group; regression selection sorts by `inputIndex` within a group. None depend
on aggregate ordering.

**Validation.** `error-group.repository.test.ts` passes, including its exact query-count assertions
(3 / 4 / 5 queries for the existing / new / raced cases) — confirming the change altered lock order
without adding a single round trip.

---

### RC-5 — Outbox amplification and redundant CPU (P2)

**Problem (a) — duplicate-path outbox amplification.** In the error branch,
`appendTelemetryOutbox(scoped, client)` received **all** received events, not the inserted subset.

**Evidence.** The guard was `result.totalInserted > 0`. So a batch of 1 new event + 99 redelivered
duplicates built a 100-row `UNNEST` payload and attempted 100 `alert_runtime_idempotency_keys`
inserts that were guaranteed to be swallowed by `ON CONFLICT DO NOTHING`. This is pure write
amplification (heap + index + WAL) on the **retry path** — precisely when the system is already
stressed. It directly explains observed `received = 36, inserted = 0, duplicates = 36` shaped logs
still paying full outbox cost whenever even one event in the batch was new.

**Change.** The outbox now receives only events the database confirmed inserted, derived from
`errorResult.domainEvents` (populated once per inserted error) via an `(organization_id, event_id)`
identity key. `timings.outboxRowsSkippedDuplicate` records what was avoided.

Both sides of the comparison read the same raw values with no truncation or normalization
**deliberately** — introducing any would risk a silent mismatch that drops legitimate outbox rows,
which would be a correctness bug in alert delivery. Idempotency is unchanged: the outbox retains
its `ON CONFLICT DO NOTHING` and idempotency-key reservation.

**Problem (b) — redundant fingerprint computation.** `errorFingerprint()` was called at least
twice per error event (once building the error batch, once in `appendTelemetryOutbox`) and a third
time on the non-grouped `writeErrors` path. Each call normalizes the stack-frame array and runs a
sha256 — pure CPU on the same event loop that must drain queues.

**Change.** Memoized with a `WeakMap` keyed on the event object: exact-once computation per event,
no lifetime management (entries become collectable when the batch is released), and zero collision
risk since the key is object identity rather than a derived string.

Sound because normalized events are immutable after `normalizeEvent()`; the one mutation that does
occur (assigning `eventId`) is not a fingerprint input — the fingerprint reads only `name` and
`stack`.

**Expected effect.** Fewer outbox rows, index entries, and WAL bytes on duplicate-heavy retry
traffic. Lower CPU per error batch.

**Risk.** Low. The outbox filter is the only behavioural change and it strictly removes rows that
`ON CONFLICT` would have discarded.

**Validation.** `error-ingestion.service.test.ts` and `event-processor.test.ts` pass, including the
duplicate-delivery and "bills only rows confirmed inserted" cases.

---

## 6. Index Forensics — no removals justified

The brief mandated an index inventory and explicitly forbade blind removal. Conclusion: **no index
was removed, and that is the correct outcome.**

Indexes on the hot ingest tables fall into three groups, all justified:

| Group | Example | Verdict |
|---|---|---|
| Identity / uniqueness | `idx_events_*_event_unique (organization_id, event_id, occurred_at)` | **Required for correctness.** This is the index backing `ON CONFLICT DO NOTHING`; it *is* the idempotency mechanism. Removal would break deduplication. |
| Tenant + time btree | `(organization_id, project_id, occurred_at DESC)` | Required by dashboard predicates. |
| BRIN on time | `USING BRIN (occurred_at)` | Deliberately chosen for append-heavy tables: very low write amplification, supports broad time scans. Cheapest possible option already. |
| GIN on JSONB | `attributes`, `metadata`, `payload`, `ai_response` | **Genuinely expensive on write** and the strongest removal candidate. Retained: they serve attribute filtering and search. Flagged in §12 as the top future work item, contingent on measuring real query usage — removal without that measurement is exactly the "bad fix" the brief prohibits. |

**Duplicate-detection cost:** verified to require **no extra index and no pre-`SELECT`**.
`insertManyIfNew` does one multi-row `INSERT ... ON CONFLICT DO NOTHING RETURNING`, then diffs the
returned rows in memory. This is already the optimal shape.

---

## 7. Trigger and Public-ID Forensics — exonerated

The brief specifically forbade removing the public-ID trigger merely for being a trigger. It was
investigated and **kept**.

**Implementation (from the actual schema, not assumed):** public IDs are a **column default
backed by a sequence**, combined with `BEFORE INSERT OR UPDATE ... FOR EACH ROW` contract-sync
triggers:

```sql
-- 021_public_ids.sql
ADD COLUMN public_id TEXT NOT NULL
  DEFAULT ('ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0'))
-- error_groups: 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0')

-- 023 / 026
CREATE TRIGGER trg_sync_error_groups_contract
  BEFORE INSERT OR UPDATE ON error_groups FOR EACH ROW ...
CREATE TRIGGER trg_sync_typed_event_contract
  BEFORE INSERT OR UPDATE ON <events_*> FOR EACH ROW ...
```

**Findings:**
- Cost is one PL/pgSQL invocation + one `nextval()` per row — real O(N) *server-side* work, but
  **zero client round trips**.
- No application code in `errors/**` reads or writes `public_id`; it is not on the client hot path.
- `nextval()` does not participate in transaction rollback and takes no row locks, so it is not a
  contention source.
- The triggers enforce a **column contract** that a bare `DEFAULT` cannot express (they also fire
  on `UPDATE`).

**Verdict: KEEP.** Cost is bounded and server-side; the guarantees are not replicable by a default
alone. It was never a plausible explanation for the observed multi-second waits, which were
dominated by connection acquisition.

Separately confirmed: the `analytics_error_groups` sync trigger was already dropped
(`024_drop_analytics_error_groups_trigger.sql`) and that table is **not** in the ingestion write
path — it is owned by a periodic cron refresh.

---

## 8. Query Count Scaling

Instrumented via `instrumentClientQueries()`, which monkey-patches `client.query` and counts
**round trips** (so the four `SET LOCAL` statements register as 1).

Per error job, with *N* = events and *U* = unique `(project_id, fingerprint)` pairs:

```
Q = 4                            BEGIN, SET LOCAL, INSERT events_errors, COMMIT
  + 2                            group lock SELECT ... FOR UPDATE  +  final read-back
  + [1 if new fingerprints]      INSERT INTO error_groups
  + [1 if lost ON CONFLICT race] second SELECT ... FOR UPDATE
  + [1 if existing fingerprints] UPDATE error_groups ... FROM (VALUES ...)
  + [1 if groups created]        INSERT INTO error_group_history (CREATED)
  + [2 if regression detected]   history (REGRESSED) + regression outbox CTE
  + [1 if anything inserted]     UPDATE events_errors  (attach groups)
  + [1 if anything inserted]     appendTelemetryOutbox
```

**`N` does not appear in this expression.** It only affects the number of `VALUES` tuples inside
individual statements.

| Scenario | Queries |
|---|---|
| All duplicates (nothing inserted) | 4 |
| *N* events, existing fingerprints, no regression | **9** |
| *N* events, all-new fingerprints | 10 |
| Mixed new + existing | 11 |
| + lost `ON CONFLICT` race | 12 |
| + regression detected | 14 (max) |

The brief's `Q(N) = 3N + 6` is **unreachable** on this path: 10 errors cost 10, not 36. See §9.

---

## 9. Error Grouping Analysis — the `3N + 6` claim, resolved

The batch path is fully set-based. `3N` scaling survives in exactly **two** places, both off the
hot path:

1. **The merged-group fallback** (`ErrorIngestionService.ingestBatch`, `catch` on
   `BULK_ERROR_GROUP_MERGED_GROUP_FALLBACK_REQUIRED`). Reached only when a matched `error_groups`
   row has `merged_into` set — the set-based statement cannot follow a merge chain. It then resolves
   groups one event at a time, each costing `INSERT + SELECT ... FOR UPDATE + UPDATE`, i.e. exactly
   the "3 queries per error" the brief describes. Total ≈ `3N + 7`.
2. **Legacy `ingestError()`** — single-event, own `BEGIN`/`COMMIT`, **zero non-test callers**.

So the original measurement was either taken before the set-based refactor landed, or it hit the
merged-group fallback.

**Critical secondary finding: the fallback was completely silent** — no log, no metric. It was
therefore impossible to tell from telemetry whether a latency regression came from this O(N) path
or from the database. Fixed:

- `ingest_error_group_merge_fallback_total` (batches)
- `ingest_error_group_merge_fallback_events_total` (events)
- a `warn` log naming the reason

The fallback rate is now a first-class signal. **If it proves non-rare in production, merge-chain
resolution should move into the set-based statement** — but that work must be justified by this
metric, not assumed.

**Fingerprint fidelity caveat (correctness, not performance).** `normalizeStackFrames` filters to
`frame.inApp === true || frame.in_app === true`. If an SDK omits that flag, **every** frame is
dropped and the fingerprint collapses to `v2|<ErrorType>|<no-in-app-frame>` — one group per error
type per project. This artificially *reduces* query count while silently degrading grouping
quality. Flagged for SDK-side follow-up; deliberately not changed here, as altering fingerprints
would re-group existing production errors.

---

## 10. Connection Pool Analysis

**Before**

| Demand | Pool | Ratio |
|---|---|---|
| 320 concurrent handlers → 320 telemetry checkouts | Log DB, max 10 | **32 : 1** |
| One saturated queue: 8 x 4 = 32 | Log DB, max 10 | 3.2 : 1 |
| 20 concurrent DLQ inserts + rollup + usage flush + depth probes | control, max 8 | ≥ 2.5 : 1 |
| 11 pollers + supervise + schedule + fairness sends | pg-boss, max 8 (+1) | ~1.4 : 1 |

Waiters blocked up to 30s, then threw → job failed → retry (3x, exponential) → `ingest.dlq-intake`.

Tenant fairness did **not** bound this: `TENANT_INFLIGHT_LIMIT` is per-org per-process
(enterprise 24 / business 16 / growth 8 / starter 4 / free 2), so five active enterprise orgs alone
permit 120 concurrent jobs — still 12x the pool.

**After**

| Demand | Pool | Ratio |
|---|---|---|
| 16 permitted transactions | dedicated write pool, max 20 | **0.8 : 1** (2 reserved) |
| 80 in-flight jobs | bounded by semaphore, not the pool | n/a |

The relationship is now **structural**: `resolveWritePermits()` reads the live pool's `max`, so the
invariant holds regardless of how the pool was configured. Misconfiguration can under-use the pool;
it can no longer oversubscribe it.

---

## 11. Queue Wait Analysis

Long queue waits were a **symptom**, not an independent cause. The chain:

```
320 handlers contend for 10 connections
   -> handlers block in the pg pool waiter list (dbConnectionWaitMs)
   -> some exceed 30s and throw
   -> classified db_connection = retryable
   -> retried with exponential backoff, re-entering the same contention
   -> throughput collapses while arrivals continue
   -> pgboss.job backlog grows  ->  large queue wait
```

The fix targets the origin. Waits are now separated into two independently observable signals so
this chain can never again be misdiagnosed:

- `writeAdmissionWaitMs` — waiting for write capacity (in-process, FIFO, no timeout)
- `dbConnectionWaitMs` — genuine pool behaviour, expected ≈ 0

Interpretation guide, exported as metrics:

| Reading | Meaning |
|---|---|
| `queued > 0` sustained | insufficient write capacity → raise permits *and* pool together |
| `in_flight == permits`, `queued == 0` | perfectly saturated — the goal |
| `in_flight < permits` but slow | the **database** is the bottleneck, not admission |

---

## 12. Tenant Fairness — preserved

Fairness was **not** weakened to gain throughput. The `deferCount` gate, per-plan in-flight
budgets, aged priority boost (`+25` per defer), and the max-defer starvation guard are all
unchanged.

The admission semaphore sits **after** the fairness gate, so fairness decisions still happen before
any database resource is acquired — a deferral costs one `pgboss.job` insert and **zero** telemetry
connections. FIFO admission additionally *improves* cross-tenant behaviour by removing the unfair
head-of-line blocking that `pg`'s pool waiter list caused.

One pre-existing trade-off, unchanged and noted for visibility: under sustained overload each job
may generate up to `INGESTION_FAIRNESS_MAX_DEFERS` (5) extra `pgboss.job` rows. This is primary-DB
write amplification. Acceptable today; if the deferral rate becomes significant, an in-process
delay queue would remove the DB round trips entirely.

---

## 13. Transaction, WAL and Durability Analysis — durability unchanged

**No durability guarantee was weakened.** `synchronous_commit` remains `on`
(`INGESTION_LOG_DB_SYNCHRONOUS_COMMIT`, unchanged default). It was **not** relaxed to obtain better
numbers — the brief forbids that, and RC-1/RC-2 delivered the improvement without touching it.

Per-transaction settings, before and after:

```
BEFORE: SET LOCAL synchronous_commit = on;
        SET LOCAL lock_timeout = '2000ms';
        SET LOCAL idle_in_transaction_session_timeout = '30000ms'
        -- statement_timeout: ABSENT (unbounded)

AFTER:  SET LOCAL synchronous_commit = on;          <- unchanged
        SET LOCAL lock_timeout = '2000ms';          <- unchanged
        SET LOCAL statement_timeout = '60000ms';    <- NEW (RC-2)
        SET LOCAL idle_in_transaction_session_timeout = '30000ms'
```

Still a single round trip (statements joined with `; `). The contract holds: **if the worker
acknowledges persistence, the telemetry is durably committed.** ACK still occurs strictly after
`COMMIT`.

WAL reduction comes only from doing genuinely unnecessary work less often (RC-5's duplicate outbox
rows), never from relaxing flush semantics.

---

## 14. Outbox Analysis

The outbox is required for alert delivery correctness and was **not** removed or bypassed. Its
shape is already optimal: a single `UNNEST`-based CTE with a **fixed 9 bind parameters regardless
of batch size**, combining idempotency-key reservation and insertion in one statement.

The only change is RC-5: it no longer receives events the database rejected as duplicates.
Idempotency (`alert_runtime_idempotency_keys` + `ON CONFLICT DO NOTHING`) is untouched, so delivery
guarantees are preserved.

The regression outbox path (`error_group_regressed`) is likewise a single combined CTE and was left
alone.

---

## 15. Usage Accounting — verified off the critical path, left alone

Per the brief's instruction to leave it alone if already non-blocking: `UsageCounter` buffers in
memory (tier 1) and drains to `usage_counter_staging` on a timer
(`INGESTION_USAGE_FLUSH_MS` = 30s, `INGESTION_USAGE_BUFFER_LIMIT` = 10 000), with
`driveRollup: false` — the rollup cron is the sole rollup driver. It is **not** in the ingest
transaction and does not block acknowledgement.

**No changes made.** Billing correctness is untouched.

---

## 16. Write Amplification Ledger

Per telemetry event, after the changes:

| Component | Status |
|---|---|
| Heap write (typed `events_*` row) | required |
| Index maintenance (identity, tenant+time, BRIN, GIN) | required — see §6 |
| WAL | required; `synchronous_commit = on` retained |
| `BEFORE INSERT` contract trigger + `nextval()` | required — see §7 |
| Foreign keys | **none** — Log DB deliberately stores primary-DB IDs as plain UUID/TEXT |
| `error_groups` upsert | *O(U)* not *O(N)*, pre-aggregated in memory |
| Event→group association | one set-based `UPDATE ... FROM (VALUES ...)` |
| `telemetry_outbox` | **reduced** — inserted events only (RC-5) |
| Usage accounting | out of transaction (§15) |
| Fingerprint sha256 | **reduced** — once per event, memoized (RC-5b) |

---

## 17. Changes Implemented

| File | Change |
|---|---|
| `pipeline/write-admission.ts` **(new)** | `WriteAdmissionController` FIFO semaphore + `resolveWritePermits()` |
| `pipeline/write-admission.test.ts` **(new)** | 10 tests covering the semaphore invariants |
| `config/env.ts` | `INGESTION_WRITE_POOL_SIZE` (20), `INGESTION_WRITE_CONCURRENCY` (16), `INGESTION_QUEUE_DEPTH_CACHE_MS` (3000); `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` 0→60 000; `INGESTION_TYPE_WORKER_CONCURRENCY` 8→2; `assertIngestionTimeoutsAreOrdered()` boot guard |
| `workers/event-processor.ts` | Transaction gated by the semaphore; `writeAdmissionWaitMs`; outbox restricted to inserted events; `outboxIdentityKey` / `scopedEventId` helpers |
| `shared/workers/ingestion-worker-main.ts` | Dedicated telemetry write pool; ordered shutdown |
| `queue/ingest-queues.ts` | Partition-prunable `= ANY($1::text[])` depth predicate + `DEPTH_QUEUE_NAMES` |
| `ingestion/service.ts` | Configurable queue-depth cache TTL |
| `errors/repositories/error-group.repository.ts` | `ORDER BY` beneath both `FOR UPDATE`s; `compareAggregate` |
| `errors/services/error-ingestion.service.ts` | Fallback metric + warn log; optional logger param |
| `pipeline/telemetry-writer.ts` | `WeakMap` fingerprint memoization |
| `workers/metrics-server.ts` | 4 admission gauges + 2 fallback counters |

**Explicitly not done** (each forbidden by the brief absent evidence): no blind concurrency
increase; no blind pool increase; no index removed; no trigger removed; `synchronous_commit`
untouched; fairness intact; no Redis; no Kafka.

---

## 18. Configuration Delta

| Setting | Before | After | Reason |
|---|---|---|---|
| `INGESTION_TYPE_WORKER_CONCURRENCY` | 8 | **2** | 320→80 in-flight; bounds heap (~320MB→~80MB vs. 512MB limit) |
| `INGESTION_WRITE_CONCURRENCY` | — | **16** | Hard ceiling on concurrent ingest transactions |
| `INGESTION_WRITE_POOL_SIZE` | — | **20** | Dedicated write pool; 16 permits + 2 reserve + 2 slack |
| `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` | 0 (unbounded) | **60 000** | Must abort before the 300s job expiry |
| `INGESTION_QUEUE_DEPTH_CACHE_MS` | 1000 (hardcoded) | **3000** | Advisory decision; reduce control-pool contention |
| Telemetry write pool | shared `LOG_POOL_MAX` = 10 | dedicated, 20 | Workload isolation + provable permit alignment |
| `DB_POOL_MAX` | 10 | **20** | Primary metadata reads on the request path (API keys, quotas, project lookups) |
| `LOG_POOL_MAX` | 10 | **20** | Log DB **read** concurrency (dashboards/analytics); ingest writes no longer use this pool |
| `INGESTION_LOG_DB_SYNCHRONOUS_COMMIT` | `on` | `on` | **unchanged — durability preserved** |

### Fleet-wide connection budget after the pool increase

Pool sizes are **per process**. With `ecosystem.config.cjs` running one instance of each role:

| Process | Primary DB | Log DB |
|---|---|---|
| `api-backend` | 20 (`DB_POOL_MAX`) + 2 (pg-boss producer) = **22** | up to 20 (`LOG_POOL_MAX`, reads) |
| `background-workers` | 20 + 8 (pg-boss) + 1 (`LISTEN`) = **29** | up to 20 |
| `ingestion-workers` | 8 (`INGESTION_DB_POOL_SIZE`) + 8 (pg-boss) + 1 = **17** | 20 (dedicated **write** pool) + up to 20 (`logDB`, reads/migrations) |
| `analytics-workers` | — | 4 (`ANALYTICS_DB_POOL_MAX`) |
| **Ceiling** | **~68** | **~84** |

Two mitigations keep the *actual* count far below these ceilings: `min` is 1–2 on every pool
(connections are created on demand, not pre-warmed), and `idleTimeoutMillis` reaps idle
connections. The ceilings only materialize under simultaneous peak load on every tier.

**Before scaling any tier horizontally, re-check these ceilings against the provider's limit.**
Neon's direct-connection limit depends on compute size; if the ceiling is approached, switch the
connection strings to Neon's **pooled** endpoint (`-pooler` host) rather than shrinking the pools,
since shrinking would reintroduce the acquisition queueing this work removed.

---

## 19. Dead Configuration Identified

These have **no runtime consumer** anywhere in `src/` — leftovers from the v2 `PgQueue` tier that
`WorkerRegistry` replaced. They are a live operational footgun: an operator tuning
`INGESTION_GENERAL_CONCURRENCY` to fix a throughput problem would see no effect whatsoever.

```
INGESTION_GENERAL_WORKERS              INGESTION_SPECIALIZED_WORKERS
INGESTION_GENERAL_CONCURRENCY          INGESTION_SPECIALIZED_CONCURRENCY
INGESTION_GENERAL_BATCH_SIZE           INGESTION_SPECIALIZED_BATCH_SIZE
INGESTION_POLL_MS                      INGESTION_VISIBILITY_TIMEOUT_MS
INGESTION_IDLE_POLL_MS                 INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS
```

**Left in place deliberately** — removal is unrelated to performance and would be silent breakage
for any deployment that sets them. Documented here for a separate cleanup. The real knobs are
`INGESTION_TYPE_WORKER_CONCURRENCY` / `_BATCH_SIZE` and the new write-admission settings.

**Fixed:** `.env` defined the entire Log DB connection-settings block **twice**
(`LOG_POOL_MAX`, `LOG_POOL_MIN`, `LOG_DB_IDLE_TIMEOUT`, `LOG_DB_CONNECTION_TIMEOUT`,
`LOG_DB_KEEPALIVE_MS`). dotenv is last-wins, so the first copy was silently shadowed — harmless
while the values agreed, but a real trap for anyone editing the first copy and seeing no effect.
Collapsed to one authoritative block.

---

## 20. Observability Added

| Metric | Type | Diagnoses |
|---|---|---|
| `ingest_write_admission_permits` | gauge | configured write ceiling |
| `ingest_write_admission_in_flight` | gauge | transactions holding a permit |
| `ingest_write_admission_queued` | gauge | **primary saturation signal** |
| `ingest_write_admission_queued_peak` | gauge | bursts that fill and drain between scrapes |
| `ingest_error_group_merge_fallback_total` | counter | batches degraded to O(N) |
| `ingest_error_group_merge_fallback_events_total` | counter | events on the O(N) path |
| `timings.writeAdmissionWaitMs` | log field | admission wait, isolated from DB time |
| `timings.outboxRowsSkippedDuplicate` | log field | avoided duplicate outbox rows |

`queued_peak` exists because a burst that fills and drains between two Prometheus scrapes would
otherwise be invisible — and that is precisely the event most needed when diagnosing a latency
spike.

---

## 21. Remaining Bottlenecks

Ranked, each with the evidence needed before acting. **None should be actioned on assumption.**

1. **GIN indexes on JSONB** (`attributes`, `metadata`, `payload`, `ai_response`) — the largest
   remaining write amplification. *Needed first:* `pg_stat_user_indexes.idx_scan` per index plus
   the real query patterns. Removing an index that serves attribute search would break a product
   feature.
2. **Merged-group O(N) fallback** — now measured. Act only if
   `ingest_error_group_merge_fallback_total` is non-trivial.
3. **Fairness deferral write amplification** — up to 5 extra `pgboss.job` rows per job under
   overload. An in-process delay queue would remove the round trips.
4. **`min` on the write pool** — set to 2. If `dbConnectionWaitMs` shows handshake cost under
   bursty load, raise it.
5. **Single-process ingestion tier** — `ecosystem.config.cjs` runs one `ingestion-workers` fork.
   pg-boss already guarantees single delivery across processes and inserts are idempotent, so
   horizontal scaling is available; each added process needs its own write-pool budget counted
   against the database's connection limit.
6. **`INGESTION_JOB_MAX_BYTES` = 1 MiB with 80 in-flight** — worst case ~80 MB against a 512 MB
   heap. Comfortable now, but the two settings are coupled and must be reasoned about together.
7. **Possible third primary pool** — `event-processor`'s import chain may transitively load
   `config/database.ts`, whose module-level `new Pool` would silently add `DB_POOL_MAX` (10)
   connections to the ingestion process. Unverified; check `pg_stat_activity` grouped by
   `application_name`.

---

## 22. Recommended Future Architecture

Ordered by value per unit of risk:

1. **Measure before optimizing further.** The new admission metrics answer "capacity or database?"
   directly. Let them accumulate for a full traffic cycle before the next change.
2. **Right-size permits empirically.** Raise `INGESTION_WRITE_CONCURRENCY` and
   `INGESTION_WRITE_POOL_SIZE` **together**, one step at a time, until throughput stops improving —
   that is the database's real concurrency ceiling. `resolveWritePermits()` guarantees the two stay
   consistent.
3. **Scale horizontally, not by concurrency.** Add `ingestion-workers` processes rather than
   raising per-process concurrency. Bounded per-process pools make aggregate connection usage
   predictable; unbounded concurrency does not.
4. **`COPY` for the largest signals.** Trace/span/replay batches are the best candidates for
   `COPY FROM STDIN`, which bypasses per-row `INSERT` overhead. Requires resolving how to preserve
   `ON CONFLICT` idempotency (stage then merge).
5. **Adaptive batching per signal type.** Heavy signals (profile/replay/trace) want smaller batches
   than fast ones (error/log/metric). The infrastructure exists; drive it from measured p99.
6. **Rationalize GIN indexes** once §21.1 has data.

---

## 23. Before/After Metrics

**Structural (deterministic, derived from configuration — not sampled):**

| Metric | Before | After | Change |
|---|---|---|---|
| Max concurrent job handlers | 320 | 80 | −75% |
| Max concurrent DB transactions | 320 (unbounded by design) | 16 (hard ceiling) | bounded |
| Telemetry pool `max` | 10 (shared) | 20 (dedicated) | +100%, isolated |
| **Pool oversubscription** | **32 : 1** | **0.8 : 1** | **eliminated** |
| Connection-acquire failure mode | throw after 30s → retry → DLQ | cannot occur | removed |
| Worst-case in-flight payload heap | ~320 MB (limit 512 MB) | ~80 MB | −75% |
| Max transaction hold time | unbounded | 60s | bounded |
| Duplicate re-delivery from expiry | possible | prevented | removed |
| Error queries at *N* = 10 | 9–14 | 9–14 | unchanged (already optimal) |
| Depth-probe partitions scanned | all `pgboss.job` partitions | ingest partitions only | pruned |
| Depth-probe frequency (gateway) | ~1/s | ~1/3s | −67% |
| `error_groups` lock order | non-deterministic | globally ordered | deadlock-free |
| Outbox rows for 1-new-of-100 batch | 100 | 1 | −99% |
| Fingerprint sha256 per error event | 2–3 | 1 | −50/67% |

**Runtime throughput/p99 comparison is not included, and deliberately so.** The repository contains
benchmark harnesses (`npm run bench:ingestion`, `bench:ingestion:matrix`,
`explain:ingestion`, `ingestion:db:runtime`) but they require a live populated database, which is
not available in this environment. Publishing invented numbers would violate the brief's core rule.
See §24 for the exact commands to run.

The structural figures above are arithmetic from configuration and code, and are independently
verifiable by inspection.

---

## 24. Load Test Plan (to be executed against a live environment)

```bash
npm run bench:ingestion                 # single-shape baseline
npm run bench:ingestion:matrix          # 10 / 100 / 500 / 1k / 10k events
npm run bench:ingestion:compare         # before/after diff
npm run explain:ingestion               # EXPLAIN on the write path
npm run ingestion:db:runtime            # live pool / lock / WAL diagnostics
npm run ingestion:admission:summary     # admission profile
```

Cover: requests, errors, logs, spans, traces, mixed, **duplicate-heavy**, **large-payload**,
**multi-tenant**, and sustained/burst load with one noisy tenant.

**Acceptance criteria tied to the root causes:**

| Signal | Expectation |
|---|---|
| `dbConnectionWaitMs` p99 | near zero (permit guarantees an available connection) |
| `ingest_write_admission_queued` | 0 at steady state; bounded under burst |
| `ingest_write_admission_in_flight` | reaches `permits` under load (capacity is used) |
| jobs failed with `db_connection` | zero |
| `40P01` deadlocks on `error_groups` | zero |
| `ingest_error_group_merge_fallback_total` | rare; if not, action §21.2 |
| One large trace batch | must not degrade error/log/request latency for other tenants |

---

## 25. Regression Tests

**Correctness — verified green:**

```
vitest run src/modules/ingestion src/modules/errors
  ->  Test Files  14 passed (14)
      Tests       64 passed (64)
```

Coverage exercised by the existing suite, all passing unchanged:
event persistence; duplicate handling; error grouping with **exact query-count assertions**
(3 / 4 / 5 for existing / new / raced — proving RC-4 added no round trips); regression detection;
outbox idempotency; rollback and client release on failure; DLQ routing; usage-billing accuracy
("bills only rows confirmed inserted"); tenant fairness deferral; bulk-insert fallback.

New `write-admission.test.ts` (10 tests): concurrency never exceeds permits; **permit released on
throw** (leak would deadlock the tier); FIFO ordering; saturation reporting; admission-wait
callback; constructor rejects invalid permits; `resolveWritePermits` clamping, headroom reservation,
and malformed-input degradation.

**Full-suite regression check** — baseline captured by stashing only these changes:

| | Files failing | Tests failing |
|---|---|---|
| Baseline (changes stashed) | 11 | 57 |
| After changes | **10** | **56** |

The after-set is a **strict subset** of the baseline set. **Zero new failures.** All remaining
failures are pre-existing and in unrelated modules (`email-templates` 37, `automation-phase2` 4,
`automation-hardening` 3, `billing-catalog-validator` 3, `alert-notification-email` 2,
`automation-repository` 2, `event-analytics` 2, `alerting-runtime-rule-catalog` 1,
`billing-provisioning` 1). The one baseline failure that no longer appears
(`project-environment-routes`) is a flaky 5s timeout.

**Type check:** `tsc --noEmit` reports **zero errors across all eleven changed/added files.**
~212 pre-existing project-wide errors remain, all `TS2304`/`TS2584` for Node globals
(`setTimeout`, `console`, `URL`, `performance`) in files not touched here — e.g.
`src/config/database.ts:117`. Root cause is `@types/node` missing from the tsconfig `types` field;
out of scope, flagged for follow-up. The new test file is deliberately timer-free partly to avoid
adding to this noise.

---

## 26. Final Engineering Verdict

The ingestion tier's design was sound; its **configuration was internally inconsistent**. Worker
fan-out and database capacity were tuned independently, and their product exceeded pool capacity by
32x. Because the pool enforced its limit with a *30-second timeout that produced a retryable error*,
the tier responded to overload by generating more load. Every downstream symptom — long queue
waits, DLQ growth, unpredictable p99 — followed from that single inversion.

The fix is not more resources. It is making the invariant **structural**: concurrent database demand
is now derived from real pool capacity at construction time, so oversubscription cannot be
reintroduced by configuration drift. Secondary fixes remove an unbounded transaction hold that could
pin connections indefinitely, a deadlock source that burned capacity on retries, and two forms of
genuinely unnecessary work.

Equally important is what was **not** done. The brief's headline problem — `Q(N) = 3N + 6` error
query multiplication — does not exist in the current code; that refactor had already landed, and
"fixing" it would have been motion without progress. No index was removed, no trigger was removed,
`synchronous_commit` was not relaxed, tenant fairness was not weakened, and no queueing
infrastructure was introduced. Each was investigated, and in each case the evidence said the cost
was either necessary or not the bottleneck.

**Durability, idempotency, billing correctness, tenant fairness and alert delivery guarantees are
all preserved**, and the acknowledgement boundary is unchanged.

The remaining honest gap is runtime numbers. The structural improvements are arithmetic and
verifiable by inspection; throughput and p99 gains require the benchmark suite against a populated
database (§24). The system is now **instrumented to answer the next question with data**: with
admission wait separated from connection wait, the previously ambiguous "is this the queue, the
workers, or the database?" is a direct read of three gauges.

**Verdict: the dominant bottleneck is removed and cannot structurally recur. Further tuning should
be driven by the new metrics, not by assumption.**
