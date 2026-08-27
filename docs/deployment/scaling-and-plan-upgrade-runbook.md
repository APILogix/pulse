# Scaling & Neon Plan Upgrade Runbook

**Audience:** whoever is about to raise the Neon compute size, add PM2 instances, or both.
**Read this first if:** you are seeing connection-timeout errors, or you are about to set
`API_INSTANCES` / `ANALYTICS_WORKER_INSTANCES` / `instances:` above 1.

**The one-sentence summary:** upgrading the Neon compute removes the *connection* ceiling
completely, but it does **not** make the ingestion tier safe to run at more than one instance —
two budgets in the ingestion worker are process-local and silently multiply per instance.

---

## Table of contents

1. [Current pool inventory](#1-current-pool-inventory-verified)
2. [Why 0.25 CU is the binding constraint today](#2-why-025-cu-is-the-binding-constraint-today)
3. [Upgrading Neon compute — the formula and the gotcha](#3-upgrading-neon-compute--the-formula-and-the-gotcha)
4. [Step-by-step upgrade procedure](#4-step-by-step-upgrade-procedure)
5. [Backend changes required BEFORE scaling out](#5-backend-changes-required-before-scaling-out)
   — §5.1 fairness (open), §5.2 write admission (open), §5.3 tenant-scope leak (**fixed**)
6. [Backend changes recommended but not blocking](#6-backend-changes-recommended-but-not-blocking)
7. [Scaling decision matrix](#7-scaling-decision-matrix)
8. [Connection-budget calculator](#8-connection-budget-calculator)
9. [Verification checklist](#9-verification-checklist)
10. [Rollback](#10-rollback)
11. [What NOT to do](#11-what-not-to-do)

---

## 1. Current pool inventory (verified)

Established by tracing the static import graph from each PM2 entry point, not by estimation.
Nine pools plus two dedicated `LISTEN` clients across four processes.

| Process | PM2 `instances` | Pool | Target DB | `max` | Source |
|---|---|---|---|---|---|
| **api-backend** | `apiInstances` | `config/database` singleton | Primary | `DB_POOL_MAX` = 20 | `src/config/database.ts:26` |
| | | `log-database` primary | Log DB | `LOG_POOL_MAX` = 20 | `src/config/log-database.ts:127` |
| | | pg-boss (producer-only) | Primary | `min(8, 2)` = 2 | `src/lib/pgboss.ts` |
| **background-workers** | `1` (hardcoded) | `config/database` singleton | Primary | 20 | reached via `modules/alerting/queue.ts` |
| | | `log-database` primary | Log DB | 20 | |
| | | pg-boss (full runtime) | Primary | 8 **+1 `LISTEN`** | |
| **ingestion-workers** | `1` (hardcoded) | control pool | Primary | `INGESTION_DB_POOL_SIZE` = 8 | `ingestion-worker-main.ts:52` |
| | | **telemetry write pool** | Log DB | `INGESTION_WRITE_POOL_SIZE` = 20 | `ingestion-worker-main.ts:126` |
| | | `log-database` primary | Log DB | 20 | reads + boot migrations only |
| | | pg-boss (full runtime) | Primary | 8 **+1 `LISTEN`** | |
| **analytics-workers** | `ANALYTICS_WORKER_INSTANCES` | own pool | Log DB | `ANALYTICS_DB_POOL_MAX` = 4 | `analytics-worker-main.ts:170` |

### Pools that do NOT exist (commonly assumed to)

- **Log DB replica pool.** `.env` sets `LOG_DB_REPLICA` to a string identical to `LOG_DB_PRIMARY`,
  and the constructor only builds a replica pool when they differ. Not created.
- **`config/database` pool inside ingestion-workers.** Its import graph is 24 modules and never
  reaches `src/config/database.ts`. Verified — the ingestion tier costs **zero** `DB_POOL_MAX`
  connections. This is why raising `DB_POOL_MAX` to 20 was free for ingestion.
- **TimescaleDB admin-log pool** (`modules/ingestion/logging/log-database.ts:99`). Not reachable
  from any worker entry point, and `TIMESCALEDB_URL` is unset.
- **`alert-workers-main.ts`.** Has npm scripts but is not a PM2 app in `ecosystem.config.cjs`.

### Per-instance connection cost

Memorize this table; everything downstream derives from it.

| Process | Primary | Log DB |
|---|---|---|
| api-backend | **22** | **20** |
| background-workers | **29** | **20** |
| ingestion-workers | **17** | **40** |
| analytics-workers | 0 | **4** |

---

## 2. Why 0.25 CU is the binding constraint today

At one instance of everything:

```
Primary = 22·1 + 29 + 17·1 =  68
Log DB  = 20·1 + 20 + 40·1 + 4·1 =  84
```

A 0.25 CU compute gives `max_connections` = 104 with 7 reserved for the superuser, so
**97 usable**.

| Database | Ceiling | Usable | Utilization |
|---|---|---|---|
| Primary | 68 | 97 | 70% — acceptable |
| **Log DB** | **84** | **97** | **87% — too tight** |

Both connection strings in `.env` are **direct** endpoints (no `-pooler` in the hostname), so they
are subject to `max_connections`.

Steady-state usage sits well below these ceilings because `min` is 1–2 (connections are created on
demand) and `idleTimeoutMillis` reaps idle ones. **The ceiling is what matters during a burst** —
and connection exhaustion is a hard failure, not a slowdown.

### The first instance you add breaks it

| api | ingestion | Primary | Log DB | Verdict at 97 usable |
|---|---|---|---|---|
| 1 | 1 | 68 | 84 | works, tight |
| **2** | 1 | 90 | **104** | Log DB exceeded |
| 3 | 1 | 112 | 124 | both exceeded |
| 1 | **2** | 85 | **124** | Log DB exceeded |
| 2 | 2 | 107 | 144 | both exceeded |

Ingestion is the most expensive tier to scale at 40 Log DB connections per instance.

---

## 3. Upgrading Neon compute — the formula and the gotcha

Per [Neon's compatibility docs](https://neon.com/docs/reference/compatibility):

```
compute_size    = min(max_compute_size, 8 × min_compute_size)
max_connections = max(100, min(4000, floor(compute_size × 419.66)))
superuser_reserved_connections = 7
usable          = max_connections − 7
```

> ### ⚠️ The gotcha: raising only the MAX compute does nothing
>
> Effective compute size is capped at **8 × your minimum**. Neon's own worked example:
> autoscaling `0.25 → 4 CU` yields `min(4, 8 × 0.25) = 2`, so you get **839** connections, not
> 1,678. Going from max 2 CU to max 4 CU changes the connection limit by **zero** unless you also
> raise the minimum.
>
> **If your goal is more connections, raise `min_compute_size`.**

### What each configuration actually gives you

| min → max CU | Effective | `max_connections` | Usable | Log DB headroom vs. 84 |
|---|---|---|---|---|
| 0.25 → 0.25 | 0.25 | 104 | **97** | 87% used — today |
| 0.25 → 2 | 2 | 839 | **832** | 10% used |
| 0.5 → 4 | 4 | 1,678 | **1,671** | 5% used |
| 1 → 8 | 8 | 3,357 | **3,350** | 2.5% used |
| 2 → 8 | 8 | 3,357 | **3,350** | 2.5% used |

**Recommended target: `0.25 → 2 CU` autoscaling.** ~8.6× current headroom, and the minimum stays
at 0.25 CU so idle cost does not rise. This supports roughly **8 API + 4 ingestion + 2 analytics**
at ~350 of 832 Log DB connections.

### Cost note

`min_compute_size` is what you pay for whenever the compute is awake. Raising the **max** only
costs money when autoscaling actually scales up. Raising the **min** raises your floor. Prefer a
low min with a high max unless you specifically need the connection count, which is the one case
where the min is load-bearing.

### Scale-to-zero interaction

Neon discards session context on suspend — session-level `SET`, advisory locks, prepared
statements, and `LISTEN`/`NOTIFY` registrations. Relevant here:

- **pg-boss** uses a dedicated `LISTEN` client and has reconnect logic, so it recovers. No action.
- **`LOG_POOL_MIN=1` / `DB_POOL_MIN=1`** keep a connection warm, which already suppresses
  suspension. If you want scale-to-zero to actually happen, set both to `0`.
- Disabling scale-to-zero is possible on paid plans but means paying for the compute 24/7.

---

## 4. Step-by-step upgrade procedure

Do these in order. Steps 1–3 are safe at any time; do not touch step 5 until section 5 is done.

### Step 1 — Record the baseline

```sql
-- Run against BOTH databases.
SHOW max_connections;
SELECT count(*) AS total,
       count(*) FILTER (WHERE state = 'active') AS active,
       count(*) FILTER (WHERE state = 'idle')   AS idle
  FROM pg_stat_activity;

-- Attribution by process. This is why every pool sets application_name.
SELECT application_name, count(*)
  FROM pg_stat_activity
 GROUP BY application_name
 ORDER BY 2 DESC;
```

Expect to see `pulse_ingestion_writes_*`, `pulse_ingestion_workers_*`, `log_primary_*`,
`pgboss_<role>_*`. Anything unexpected means a pool exists that this document does not account
for — stop and investigate before scaling.

### Step 2 — Raise the compute in the Neon Console

Branches → select compute → **Edit** → Compute tab. Set **min 0.25 CU, max 2 CU**.
The console displays the resulting **direct connections** figure; confirm it reads ~839.

Do this for **both** projects (`ep-broad-cherry…` primary and `ep-steep-dream…` Log DB). They are
separate Neon projects with independent compute settings — upgrading one does not upgrade the other.

### Step 3 — Re-verify

```sql
SHOW max_connections;  -- expect 839
```

No application restart is required for a compute resize. No backend change is required for step 2.

### Step 4 — Apply the backend changes in section 5

Required only if you intend to run **more than one ingestion-workers instance**.

### Step 5 — Scale out, one tier at a time

```bash
# Safe immediately after step 3 — api-backend holds no process-local budgets.
# Note: capped at CPU count by Math.min(cpuCount, API_INSTANCES).
API_INSTANCES=4 npm run pm2:reload

# Safe immediately — analytics rollups are whole-bucket recomputes and converge.
ANALYTICS_WORKER_INSTANCES=2 npm run pm2:reload
```

`background-workers` and `ingestion-workers` are hardcoded `instances: 1` in
`ecosystem.config.cjs`. Raising ingestion requires editing that file **and** completing section 5
first.

After each change, re-run the `pg_stat_activity` query from step 1 and compare against
section 8's calculator.

---

## 5. Backend changes required BEFORE scaling out

These are **not** fixed by upgrading the plan. A bigger compute makes them easier to hit, because
it removes the connection ceiling that was accidentally preventing you from scaling into them.

### 5.1 — BLOCKER: tenant fairness dilutes per process

**Where:** `src/modules/ingestion/workers/worker-registry.ts` — `private readonly inFlight = new Map<string, number>()`, consumed in `runOne()`.
**Budget source:** `TENANT_INFLIGHT_LIMIT` in `src/modules/ingestion/queue/ingest-queues.ts:97`
(`enterprise: 24, business: 16, growth: 8, starter: 4, free: 2`).

The budget is an in-memory `Map` scoped to one process. With *K* ingestion processes, one tenant's
effective concurrency is **`TENANT_INFLIGHT_LIMIT × K`**:

| Instances | Enterprise org effective concurrency |
|---|---|
| 1 | 24 (correct) |
| 2 | 48 |
| 4 | 96 |

Tenant fairness — an explicit product guarantee — degrades linearly with instance count, silently.
No error, no metric spike; noisy neighbours simply reappear.

**Stopgap (immediate, crude, honest):** divide the budget by expected instance count.

```ts
// ingest-queues.ts — introduce INGESTION_WORKER_INSTANCES and divide.
const K = Math.max(1, env.INGESTION_WORKER_INSTANCES);
const perProcessLimit = Math.max(1, Math.floor(TENANT_INFLIGHT_LIMIT[tier] / K));
```

Correct in aggregate; imprecise because it cannot rebalance when a process is idle. Acceptable for
K ≤ 4. Requires keeping the env var in sync with the PM2 `instances` value — a real footgun, so
log the resolved value at boot.

**Proper fix:** move the budget to a fleet-visible lease. Options, cheapest first:

1. A `pg_advisory_xact_lock`-gated counter table in the primary DB, incremented on admit and
   released on transaction end. Adds one round trip per job to the control pool.
2. A short-TTL lease row per `(org, process)` with a sweeper for crashed holders.
3. Push fairness into job selection instead of post-fetch admission — have pg-boss hand out at most
   N jobs per org via a partial index and `SKIP LOCKED`. Most invasive, best behaviour, no
   per-job coordination cost.

Recommend option 1 for K ≤ 8; revisit if per-job latency becomes measurable.

### 5.2 — BLOCKER: write admission is per process

**Where:** `src/modules/ingestion/pipeline/write-admission.ts` — `WriteAdmissionController`,
instantiated per `EventProcessor`.

`resolveWritePermits()` reads the **local** pool's `max` and guarantees that *this* process cannot
oversubscribe *its own* pool. It knows nothing about siblings. With `INGESTION_WRITE_CONCURRENCY`
= 16:

| Instances | Concurrent write transactions on the Log DB |
|---|---|
| 1 | 16 |
| 2 | 32 |
| 4 | **64** |

At 839 `max_connections` the database will happily *accept* 64 connections. Whether a 2 CU compute
(2 vCPU, 8 GB) can *serve* 64 concurrent write transactions without collapsing tail latency is a
different question — and the answer is likely no.

This is the expected transition: **the bottleneck moves out of connection acquisition and into
PostgreSQL CPU/IO.** It is the point at which
[`docs/ingestion-performance-forensics.md`](../ingestion-performance-forensics.md) §22 applies —
raise permits and pool size *together*, one step at a time, until throughput stops improving. That
plateau is the database's real concurrency ceiling, and it must be measured, not assumed.

**Action:** treat `INGESTION_WRITE_CONCURRENCY` as a **fleet-wide** budget and divide it by
instance count:

```
per-process permits = floor(FLEET_WRITE_CONCURRENCY / INGESTION_WORKER_INSTANCES)
```

Then size `INGESTION_WRITE_POOL_SIZE` to `per-process permits + 2` reserve.

Example for a fleet budget of 32 across 2 instances:

```env
INGESTION_WORKER_INSTANCES=2
INGESTION_WRITE_CONCURRENCY=16   # per process; 16 × 2 = 32 fleet-wide
INGESTION_WRITE_POOL_SIZE=18     # 16 permits + 2 reserve
```

**Do not** simply leave `INGESTION_WRITE_CONCURRENCY=16` and run four instances expecting the
semaphore to protect you. It will not — that is not what it bounds.

### 5.3 — ✅ FIXED: session-level `SET` leaked tenant scope across pooled connections

> **Status: resolved.** No action required. Documented here because it was a blocker for §6.3
> (pooled endpoint) and because the failure mode is worth understanding.

**Was:** `src/config/log-database.ts`, inside `getConnection()`:

```ts
if (options?.projectId) {
  await client.query('SET app.current_project_id = $1', [options.projectId]);   // session-scoped
}
```

Applied at **checkout**, before any `BEGIN`. A bare `SET` is session-scoped, so the value survived
`COMMIT`, survived `client.release()`, and remained attached to the connection sitting in the `pg`
pool. The next borrower silently inherited the previous tenant's project id. Nothing reset it.

**Severity assessment:** not exploitable at the time of the fix. A search of
`database/migrations/**` found no `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY`, and no
`current_setting` reader — nothing consumed the GUC on the Log DB. It was a loaded gun: the moment
anyone added an RLS policy (the setting's entire purpose) it would have become a cross-tenant
disclosure bug, invisible in testing because it only manifests on connection reuse under
concurrency.

**Now:**

- `getConnection()` no longer accepts `projectId` and emits no session state at checkout. An option
  that *looked* like it set tenant scope but could not do so safely is worse than no option, because
  it fails open.
- New private `applyTenantScope()` uses
  `SELECT set_config('app.current_project_id', $1, true)`. `is_local = true` makes it
  transaction-scoped, so PostgreSQL reverts it at COMMIT/ROLLBACK — leak-proof *by construction*
  rather than by remembering to reset. `set_config()` also binds the value as a real parameter;
  literal `SET LOCAL` would have required interpolating a caller-supplied value into SQL.
- Applied **after** `BEGIN` in both `withTransaction()` and `runWithTimeout()`.
- Requesting a tenant scope now **forces a transaction even when the timeout is 0**. Previously
  `timeout <= 0` took a no-transaction fast path; applying `is_local = true` there would have been a
  silent no-op leaving the statement unscoped. Correctness over one saved round trip.
- This matches the pattern already used correctly in `src/modules/analytics/repository.ts`.

**Regression tests:** `src/config/log-database.test.ts` (11 tests) pins the invariants — checkout
emits nothing; no bare `SET` is ever used; the scope follows `BEGIN`; the value is bound not
interpolated; a scope forces a transaction; the fast path survives when neither timeout nor scope is
requested; and the original leak scenario (tenant A scoped, then tenant B unscoped on the same
connection) asserts B sees no residue.

**Consequence for §6.3:** the `SET`-related blocker to pooling the Log DB is cleared. The remaining
pooling prerequisite is routing `pg_advisory_lock` migrations to the direct endpoint.

---

## 6. Backend changes recommended but not blocking

### 6.1 — Cap the redundant `logDB` pool in the ingestion process

The ingestion worker holds **40** Log DB connections: 20 dedicated write pool + 20 `log-database`
singleton. Since ingest writes moved to the dedicated pool, the singleton serves only boot
migrations, the health check, and occasional telemetry reads. It does not need 20.

Capping it at ~4 takes the ingestion tier from 40 → **24** Log DB connections, and the fleet
ceiling from 84 → **68** (70%, matching Primary). Two approaches:

- **Role-aware cap** in `log-database.ts`: when `PROCESS_ROLE === 'ingestion'`, clamp
  `LOG_POOL_MAX` low. Self-maintaining, no new knob. *Preferred.*
- **New env var** `LOG_READ_POOL_MAX`: more explicit, one more value to keep in sync.

Worth doing regardless of scaling — it is pure idle waste.

### 6.2 — Revert `DB_POOL_MIN` to 0

`src/config/env.ts` documents the intent for the log pool as *"Do not pin warm log connections in
every API replica while idle"* and defaults `DB_POOL_MIN` to `0`. `.env` currently sets `1`, which
holds one connection open per process, prevents Neon scale-to-zero, and multiplies by instance
count. Set to `0` unless you specifically want a warm connection to avoid first-request handshake
latency.

### 6.3 — Consider Neon's pooled endpoint for the Log DB

The real unlock if you ever need beyond a few thousand connections: the pooled endpoint accepts up
to 10,000 client connections, decoupling application pool sizing from `max_connections` entirely.

Compatibility audit for **the Log DB specifically**:

| Requirement | Status |
|---|---|
| Timeouts via `SET LOCAL` inside transactions | ✅ safe — `log-database.ts`, `applyIngestionTransactionSettings()` |
| pg-boss `LISTEN`/`NOTIFY` | ✅ unaffected — pg-boss is on the **Primary** (`DATABASE_URL`), not the Log DB |
| `app.current_project_id` tenant scope | ✅ **fixed** — now `set_config(..., true)`, transaction-scoped. See §5.3 |
| `pg_advisory_lock` in `shared/logdb/migrations.ts:186` | ⚠️ session-scoped — pin migrations to the **direct** endpoint |

So the remaining sequence is: route `applyLogDbMigrations` to the direct endpoint, then move Log DB
application traffic to the `-pooler` host.

**Keep the Primary on the direct endpoint.** pg-boss requires `LISTEN`/`NOTIFY`, which transaction
pooling does not support.

### 6.4 — Dead configuration

These have no runtime consumer (leftovers from the v2 `PgQueue` tier). Tuning them has no effect —
a live footgun during a scaling exercise:

```
INGESTION_GENERAL_WORKERS       INGESTION_SPECIALIZED_WORKERS
INGESTION_GENERAL_CONCURRENCY   INGESTION_SPECIALIZED_CONCURRENCY
INGESTION_GENERAL_BATCH_SIZE    INGESTION_SPECIALIZED_BATCH_SIZE
INGESTION_POLL_MS               INGESTION_VISIBILITY_TIMEOUT_MS
INGESTION_IDLE_POLL_MS          INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS
```

The real knobs are `INGESTION_TYPE_WORKER_CONCURRENCY`, `INGESTION_TYPE_WORKER_BATCH_SIZE`,
`INGESTION_WRITE_CONCURRENCY`, and `INGESTION_WRITE_POOL_SIZE`.

---

## 7. Scaling decision matrix

| Tier | Safe to scale today? | Blocker | Notes |
|---|---|---|---|
| **api-backend** | ✅ yes, after compute upgrade | none | No process-local budgets. Capped at CPU count by `Math.min(cpuCount, API_INSTANCES)`. Costs 22 Primary + 20 Log DB each. |
| **analytics-workers** | ✅ yes, after compute upgrade | none | `ecosystem.config.cjs` documents it as safe: pg-boss `SKIP LOCKED`, and rollups are whole-bucket recomputes that converge. Costs 4 Log DB each. |
| **ingestion-workers** | ❌ **no** | §5.1 fairness, §5.2 write admission | Also requires editing the hardcoded `instances: 1`. Costs 17 Primary + 40 Log DB each. |
| **background-workers** | ⚠️ untested | not audited | Hardcoded `instances: 1`. Runs cron/singleton work; assume unsafe until its schedulers are audited for duplicate execution. Costs 29 Primary + 20 Log DB each. |

---

## 8. Connection-budget calculator

With `background-workers` fixed at 1:

```
Primary = 22·api + 29 + 17·ingestion
Log DB  = 20·api + 20 + 40·ingestion + 4·analytics

usable  = max_connections − 7
```

Target **≤ 70% of usable** so a burst plus a rolling restart cannot exhaust the limit. During a PM2
reload, old and new processes briefly coexist — a 100%-provisioned fleet will fail its own deploy.

### Worked examples at 0.25 → 2 CU (839 max, 832 usable)

| api | ingestion | analytics | Primary | Log DB | % of usable |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 68 | 84 | 8% / 10% |
| 4 | 1 | 2 | 134 | 148 | 16% / 18% |
| 8 | 2 | 2 | 239 | 268 | 29% / 32% |
| 8 | 4 | 4 | 273 | 356 | 33% / 43% |
| 16 | 4 | 4 | 449 | 516 | 54% / 62% |

After the §6.1 cap (ingestion Log DB 40 → 24):

| api | ingestion | analytics | Log DB | % of usable |
|---|---|---|---|---|
| 8 | 4 | 4 | 292 | 35% |
| 16 | 8 | 4 | 548 | 66% |

Note that at 8 ingestion instances the §5.2 write-concurrency problem dominates long before
connections do: 8 × 16 = 128 concurrent write transactions.

---

## 9. Verification checklist

### After a compute upgrade (no code change)

- [ ] `SHOW max_connections;` returns the expected value on **both** databases
- [ ] Neon Console "direct connections" matches the formula in §3
- [ ] `pg_stat_activity` totals unchanged (a resize does not change client behaviour)
- [ ] No `too many connections` (SQLSTATE `53300`) in application logs
- [ ] `ingest_jobs_failed_total{reason="db_connection"}` is flat at zero

### After scaling any tier

- [ ] `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1` matches §8's prediction
- [ ] `ingest_write_admission_queued` returns to 0 at steady state
- [ ] `ingest_write_admission_in_flight` reaches `permits` under load (capacity is being used)
- [ ] `dbConnectionWaitMs` p99 stays near zero
- [ ] No `40P01` (deadlock) on `error_groups`
- [ ] `ingest_error_group_merge_fallback_total` remains flat

### After scaling ingestion specifically

- [ ] Per-org concurrency observed under a single-noisy-tenant load test matches
      `TENANT_INFLIGHT_LIMIT`, **not** a multiple of it
- [ ] Fleet-wide concurrent write transactions equal the intended budget, not
      `16 × instances` — check via `count(*) FROM pg_stat_activity WHERE state = 'active'`
      filtered to `application_name LIKE 'pulse_ingestion_writes%'`
- [ ] Duplicate-heavy and multi-tenant benchmark shapes show no regression
      (`npm run bench:ingestion:matrix`)
- [ ] One large trace batch does not degrade error/log/request latency for other tenants

---

## 10. Rollback

**Compute upgrade:** resize down in the Neon Console. Non-destructive, no restart. Connections
above the new limit are refused, so scale instances down *first*.

**Instance scale-out:**

```bash
API_INSTANCES=1 ANALYTICS_WORKER_INSTANCES=1 npm run pm2:reload
```

For ingestion, revert `instances:` in `ecosystem.config.cjs` and redeploy. In-flight jobs are safe:
pg-boss redelivers on process death and inserts are idempotent via
`ON CONFLICT DO NOTHING` on the identity indexes.

**Order matters when rolling back both:** reduce instances, confirm `pg_stat_activity` has dropped,
then reduce compute.

---

## 11. What NOT to do

- ❌ **Do not raise max compute alone** expecting more connections. Effective size is
  `min(max, 8 × min)`. Raise the **min**.
- ❌ **Do not scale ingestion-workers** before §5.1 and §5.2. It silently breaks tenant fairness and
  hands the database 16 × K concurrent writers.
- ❌ **Do not raise `INGESTION_WRITE_CONCURRENCY` without raising `INGESTION_WRITE_POOL_SIZE`.**
  `resolveWritePermits()` clamps to `pool.max − reserve`, so the extra permits are silently
  discarded and you will conclude, wrongly, that concurrency did not help.
- ❌ **Do not move the Primary to the pooled endpoint.** pg-boss needs `LISTEN`/`NOTIFY`.
- ❌ **Do not move the Log DB to the pooled endpoint** before fixing §5.3.
- ❌ **Do not provision to 100% of `max_connections`.** Rolling restarts need overlap headroom.
- ❌ **Do not lower `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` above `INGESTION_JOB_EXPIRE_SECONDS`.**
  The boot guard `assertIngestionTimeoutsAreOrdered()` will refuse to start, by design.
- ❌ **Do not tune the §6.4 dead variables** and conclude the system is unresponsive to tuning.

---

## Related documents

- [Ingestion Pipeline Performance Forensics](../ingestion-performance-forensics.md) — why the
  write-admission semaphore and dedicated write pool exist, and the remaining bottleneck ranking
- [Environment Variables & Connection Pool Sizing Reference](./environment-configuration.md)
- [Production Deployment & PM2 Orchestration Guide](./production-deployment-guide.md)
- [Database Operations, Migrations & Maintenance Runbook](./database-operations.md)

*Neon limits and formulas sourced from [Neon compatibility docs](https://neon.com/docs/reference/compatibility)
and [Neon connection pooling docs](https://neon.com/docs/connect/connection-pooling).
Content was rephrased for compliance with licensing restrictions.*
