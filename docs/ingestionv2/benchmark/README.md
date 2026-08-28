# Ingestion capacity & load benchmark — README

Status: **framework built and code-reviewed; BENCHMARK NOT EXECUTED.** No run has completed against any target as of this document's date. Every number in the 15 reports in this directory is `NOT MEASURED` unless a report explicitly cites a JSON artifact under `artifacts/`.

This is the permanent home of the ingestion capacity benchmark. It stays in the repository as a regression suite — run it after worker, batching, index, trigger, PostgreSQL, Neon, queue, concurrency, or schema changes.

## 0. What this is, and what it is not

- **Ingestion capacity benchmark** (this document, `scripts/bench-ingestion-http.ts`): drives the REAL path — `POST /api/v1/<type>` → API-key auth → Fastify/AJV validation → `IngestionService` → pg-boss enqueue → worker dispatch → DB commit → HTTP 202. This is what "events/second" and "events/minute" mean in these reports.
- **NOT the same as** `npm run bench:ingestion` (`scripts/bench-ingestion-worker.ts`): that script calls `TelemetryWriter`/`EventProcessor` directly, skipping HTTP, auth, and pg-boss. It is a **DATABASE-ONLY MICROBENCHMARK**, useful for isolating INSERT/index/trigger/outbox SQL cost, but its numbers must never be quoted as ingestion capacity. See [`01-tooling-classification.md`](01-tooling-classification.md).

## 1. Prerequisites

1. The backend must be running and reachable over HTTP. Either:
   - your deployed API (any environment), or
   - a local instance: `npm run dev` (API) + `npm run dev:ingestion` (worker), with `DATABASE_URL`/`LOG_DATABASE_URL` set.
2. `DATABASE_URL` pointing at the Primary DB that backs the API you're targeting — needed once, to provision a benchmark fixture (org/project/API key), not needed by the generator itself at request time.
3. Node/`npx`/`tsx` available (already a repo dependency; no separate install needed).
4. Decide your **environment label**. It must be in the allowlist (`INGESTION_BENCH_ENV_ALLOWLIST`, default: `staging,bench,benchmark,local`). If you're pointing at a shared/staging environment, `--environment staging` or `--environment benchmark` both work by default.

## 2. Provision a benchmark fixture (once per benchmark run/session)

```powershell
npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag smoke1
```

This creates (idempotently, re-runnable with the same `--tag`):
- one benchmark-tagged user (`pulse-bench-smoke1-owner@bench.invalid`)
- one benchmark-tagged organization, project, environment (all named `pulse-bench-smoke1-...`)
- one active API key with `ingest` permission

It prints a JSON object to stdout. **Copy the `fullApiKey` value** — it is only ever shown once and is not recoverable afterward (only its hash is stored, matching how real API keys work).

To remove everything this created later:
```powershell
npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag smoke1 --print-cleanup-sql
```
This prints a `DELETE` script scoped only to rows matching `pulse-bench-smoke1-%` / `...@bench.invalid`. Review it, then run it manually against your database — the provisioning script never deletes anything itself.

## 3. Run a benchmark

All commands below assume the backend is reachable at `$TARGET_URL` and you have `$API_KEY` from step 2.

### FAST REGRESSION (CI-safe, ~20 seconds, safe to run repeatedly)

```powershell
npm run bench:ingestion:http:fast-regression -- --target-url $TARGET_URL --api-key $API_KEY --environment benchmark
```

Runs `baseline` mode: ~5 events/sec, 20 seconds, mixed profile. This is what CI or a pre-deploy smoke check should run. It is deliberately low-volume and does not attempt to find a saturation point.

### BASELINE (manual, any duration/rate you choose)

```powershell
npx tsx scripts/bench-ingestion-http.ts --mode baseline `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --duration-seconds 20 --rate 2 --batch-size 5 `
  --out artifacts/bench-http-baseline.json
```

### FIXED-RATE (sustained constant offered rate)

```powershell
npx tsx scripts/bench-ingestion-http.ts --mode fixed-rate `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --rate 50 --batch-size 50 --duration-seconds 60 --profile mixed `
  --worker-metrics-url http://<worker-host>:9465/metrics `
  --out artifacts/bench-http-fixed-rate.json
```

### FULL CAPACITY (ramp-to-saturation, burst, sustained, soak) — **ISOLATED ENVIRONMENT ONLY**

These modes are refused unconditionally against any target URL that looks like production (hostname containing `prod`, `live`, `api.pulse.`, etc.) — no override flag unlocks them. Run these only against a dedicated benchmark environment (a Neon branch, a disposable staging clone, or a local instance pointed at a throwaway database):

```powershell
# Ramp to saturation with automatic stop + recovery check
npx tsx scripts/bench-ingestion-http.ts --mode ramp `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --rate-steps 5,10,25,50,100,200,400 --step-duration-seconds 30 `
  --worker-metrics-url http://<worker-host>:9465/metrics --db-url $DATABASE_URL `
  --out artifacts/bench-http-ramp.json

# Burst absorption + recovery
npx tsx scripts/bench-ingestion-http.ts --mode burst `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --burst-rate 300 --burst-duration-seconds 5 --quiet-rate 5 --quiet-duration-seconds 20 --burst-cycles 5 `
  --worker-metrics-url http://<worker-host>:9465/metrics `
  --out artifacts/bench-http-burst.json

# Sustained load (connection exhaustion, memory growth, WAL pressure)
npx tsx scripts/bench-ingestion-http.ts --mode sustained `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --rate 100 --duration-seconds 600 --worker-metrics-url http://<worker-host>:9465/metrics `
  --out artifacts/bench-http-sustained.json

# Soak (multi-hour stability / leak detection)
npx tsx scripts/bench-ingestion-http.ts --mode soak `
  --target-url $TARGET_URL --api-key $API_KEY --environment benchmark `
  --rate 50 --duration-seconds 14400 --soak-check-interval-seconds 300 `
  --worker-metrics-url http://<worker-host>:9465/metrics `
  --out artifacts/bench-http-soak.json
```

### Workload profiles

Add `--profile <name>` to any mode above. Available: `request-heavy`, `log-heavy`, `error-heavy`, `trace-heavy`, `mixed` (default), `duplicate-heavy`, `large-payload`, `multi-tenant`, `worst-case`. See [`03-workload-profiles.md`](03-workload-profiles.md).

**`duplicate-heavy` safety gate:** if the profile includes `log` events with a nonzero duplicate ratio, the generator checks whether `idx_events_logs_event_unique` exists on the target's Log DB before proceeding (pass `--log-db-url` for this check). If the guard is absent, the run is **refused** with an explanation, not silently degraded — this protects against creating uncleanable duplicate rows and inflating billing counters. Override only with `--allow-unsafe-duplicate-logs`, and only if you understand and accept that consequence.

### Multi-tenant

Add `--tenants N` is not yet a flag on the CLI directly for the HTTP generator in this version; the `multi-tenant`/`worst-case` profiles are designed to be run with N separately-provisioned fixtures (`--tag tenant1`, `--tag tenant2`, ...) and N concurrent generator processes, one per tenant, so each addresses its own real API key and exercises the real per-organization fairness gate in `WorkerRegistry`. See [`10-multitenant-results.md`](10-multitenant-results.md) for the exact recipe.

## 4. Index/trigger observation and A/B testing

Read-only, safe against any target, right now:
```powershell
npx tsx scripts/bench/observe-public-id-mechanism.ts --db-url $LOG_DATABASE_URL
```

A/B testing an index/trigger candidate requires an isolated schema and a reviewed variant file — see [`scripts/bench/schema-variants/README.md`](../../../scripts/bench/schema-variants/README.md) and [`09-index-trigger-impact.md`](09-index-trigger-impact.md). **Not runnable yet**: no variant SQL has been authored, because doing so safely requires querying the exact index DDL on the actual isolated target first (see that README for why).

## 5. Interpreting output

Every run prints (and optionally writes via `--out`) one JSON report containing:
- `config` — exact mode/profile/rate/batch-size/environment used.
- `modeResult` — mode-specific results (see `scripts/bench/load-modes.ts` types for the exact shape per mode).
- `logIdempotencyGuardStatus` — whether the duplicate-safety check ran and what it found.
- `workerSamples` / `dbSamples` — every collected telemetry sample, timestamped, for post-hoc analysis.
- `workerMetricsReachable` / `dbMetricsReachable` — **check these before trusting any queue/DB-derived number.** If `false`, no worker or DB samples were collected and every queue/DB-derived criterion in the sustainability verdict is `unmeasured`, not passing.

**Accepted ≠ durable.** The generator's `accepted` count means pg-boss enqueue succeeded, not that the event was committed to the typed table. To measure durable completion rate, compare `workerSamples[].eventsInsertedByType` deltas over the run window (requires `--worker-metrics-url`).

## 6. Regression comparison

Compare two JSON reports with the same shape as the existing comparator:
```powershell
npm run bench:ingestion:compare -- --baseline artifacts/bench-http-baseline-before.json --candidate artifacts/bench-http-baseline-after.json
```
(The existing comparator expects `bench-ingestion-worker.ts`'s field names; adapting it to the HTTP generator's report shape, or writing a dedicated `compare-ingestion-http-benchmarks.ts`, is listed as follow-up work in [`15-regression-benchmark.md`](15-regression-benchmark.md).)

## 7. Report index

| # | Report | Status |
| --- | --- | --- |
| 01 | [Benchmark overview](01-benchmark-overview.md) | Written |
| 02 | [Test methodology](02-test-methodology.md) | Written |
| 03 | [Workload profiles](03-workload-profiles.md) | Written |
| 04 | [Current capacity](04-current-capacity.md) | NOT MEASURED |
| 05 | [Bottleneck analysis](05-bottleneck-analysis.md) | NOT MEASURED |
| 06 | [Database capacity](06-database-capacity.md) | NOT MEASURED (Neon config unknown) |
| 07 | [Worker capacity](07-worker-capacity.md) | Written (static config only) |
| 08 | [Queue capacity](08-queue-capacity.md) | Written (static config only) |
| 09 | [Index/trigger impact](09-index-trigger-impact.md) | NOT MEASURED / scaffolded |
| 10 | [Multi-tenant results](10-multitenant-results.md) | NOT MEASURED |
| 11 | [Saturation analysis](11-saturation-analysis.md) | NOT MEASURED |
| 12 | [Recovery analysis](12-recovery-analysis.md) | NOT MEASURED |
| 13 | [Neon upgrade comparison](13-neon-upgrade-comparison.md) | NOT MEASURED |
| 14 | [Recommended safe capacity](14-recommended-safe-capacity.md) | NOT MEASURED — no ceiling can be recommended yet |
| 15 | [Regression benchmark](15-regression-benchmark.md) | Written |

Also see: [`00-discovered-architecture.md`](00-discovered-architecture.md), [`01-tooling-classification.md`](01-tooling-classification.md) (Stage A audit, produced before any code was written).
