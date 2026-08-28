# Existing benchmark tooling: classification (Stage A)

Audit date: 2026-08-27. Purpose: decide reuse vs. build before writing new code, and prevent the mistake spec §30 explicitly forbids — presenting a direct-DB/direct-processor path as "ingestion capacity."

## Inventory

| File | What it does | Path exercised |
| --- | --- | --- |
| `scripts/bench-ingestion-worker.ts` | Drives `TelemetryWriter` (`--mode writer`, rollback by default) or `EventProcessor.process()` (`--mode processor --commit`) directly in-process. Has sustained time-boxed windows, warmup/measurement separation, WAL-delta sampling via `pg_current_wal_lsn()`, per-signal mix allocation, per-org share allocation, statement counting, quantile aggregation, PM2 restart detection, `Measured<T>`/`Provenance` envelopes. | **Bypasses** HTTP gateway, AJV validation, API-key auth/resolution, quota check, backpressure shedding, pg-boss enqueue, pg-boss delivery/callback batching, and `WorkerRegistry` fairness/admission. Calls `TelemetryWriter`/`EventProcessor` methods directly. |
| `scripts/run-ingestion-benchmark-matrix.ts` | Spawns `bench-ingestion-worker.ts` as a child process across a matrix of type/batch-size/tenants/worker-concurrency/traffic-profile combinations. `--dry-run` prints planned commands without executing. | Same limitation as above — it is an orchestration wrapper, inherits the same bypass. |
| `scripts/compare-ingestion-benchmarks.ts` | Diffs two single-run JSON reports against configurable regression thresholds (p95/p99/p999/throughput). | Format-agnostic; reusable once the new generator's JSON shape is compatible or adapted. |
| `scripts/summarize-ingestion-benchmark-matrix.ts` | Renders a matrix JSON into a Markdown/JSON acceptance table. | Reusable pattern; will be adapted for the new report set. |
| `scripts/lib/ingestion-evidence.ts` | `Measured<T>` / `Provenance` envelope, environment allowlist (`INGESTION_BENCH_ENV_ALLOWLIST`, default `staging,bench,benchmark,local`), `assertBenchEnvironment()` that exits non-zero before any DB work against a disallowed label. | **This is the correct safety primitive and will be reused as-is**, not reinvented, for the new HTTP-level generator. |
| `scripts/lib/statement-counter.ts`, `scripts/lib/aggregate.js` | Per-client SQL statement counting; repetition filtering/summarization helpers. | Reusable directly by any harness that has direct DB client access (i.e., the metrics collector side, not the HTTP generator itself, which has no DB client). |

## Classification against spec §30 and §26

**`bench-ingestion-worker.ts` (writer/processor modes) is a DATABASE-ONLY / PROCESSOR-ONLY MICROBENCHMARK.** It measures real INSERT/index/trigger/outbox SQL cost and real `EventProcessor` transaction cost, which is legitimate and valuable — but it is explicitly **not** ingestion capacity, because it skips:

- HTTP request parsing and AJV schema validation cost,
- API-key resolution (cache hit/miss SQL, LRU behavior under load),
- quota pre-check,
- backpressure/shedding decision cost,
- pg-boss bulk-insert enqueue cost and queue contention,
- pg-boss job delivery, callback batching (`localConcurrency`/`batchSize`), and expiry/redelivery behavior,
- `WorkerRegistry` per-org fairness gating and write-admission queueing under real concurrent load from multiple independent workers.

Per spec §30, every report and every capacity table entry produced by this framework will **explicitly label** any number that comes from `bench-ingestion-worker.ts` as:

```
DATABASE-ONLY MICROBENCHMARK (writer/processor mode) — NOT ingestion capacity
```

It will never be presented as, or substituted for, "sustainable events/second" in the final capacity table (spec §26).

## What is missing and must be built

1. **HTTP-level workload generator** — issues real `POST /api/v1/<type>` requests with real API keys, through the real gateway, measuring end-to-end from request send to either the HTTP 202 response (accepted-rate) or to durable worker COMMIT (durable-rate), the latter requires a correlated read-side check (see §8 below).
2. **Ramp-to-saturation controller** — automatic rate stepping with stop conditions (spec §11), not present in either existing script.
3. **Recovery test** — reduce load after saturation and measure drain/recovery time (spec §22), not present.
4. **Soak mode** — long-duration stability monitoring for leaks/gradual degradation (spec §23), not present (existing `--sustained` is a single bounded window, not an indefinite soak with degradation trend detection).
5. **Multi-tenant fairness measurement across real worker fairness gates** — `bench-ingestion-worker.ts --org-shares` measures per-org allocation at the offered/direct-write level, but does **not** exercise `WorkerRegistry`'s actual per-process `TENANT_INFLIGHT_LIMIT` gate, because it never goes through `WorkerRegistry`.
6. **End-to-end durable-completion correlation** — the HTTP generator only observes `accepted` (enqueued). To measure true "durable completed events/second" (spec §9) it must correlate against either: (a) worker-exported Prometheus counters (`ingest_events_inserted_by_type_total`), or (b) a benchmark-scoped read query against typed tables filtered by a benchmark batch tag. Design uses (a) as the primary signal since it is already exported and non-invasive.
7. **Index/trigger A/B scaffolding on an isolated schema** (spec §15–17) — does not exist; must be schema-migration-driven against a Neon branch, never hand-authored.
8. **Report generation for the 15 required documents** (spec §25) — does not exist in this shape; `summarize-ingestion-benchmark-matrix.ts` produces one Markdown table, not a structured report set.
9. **Duplicate-heavy safety gate** — neither script checks the live `events_logs` idempotency gap before running a billing-sensitive duplicate profile. Must be added (spec §21).

## Decision

- Reuse: `scripts/lib/ingestion-evidence.ts` (environment gating, `Measured<T>`), `scripts/lib/aggregate.js`, `scripts/lib/statement-counter.ts`, the comparator/summarizer patterns.
- Relabel, do not rebuild: `bench-ingestion-worker.ts` stays as the **database-only microbenchmark** entrypoint (`npm run bench:ingestion`), documented as such everywhere it is referenced.
- Build new: an HTTP-level generator (`scripts/bench-ingestion-http.ts`) implementing baseline/fixed-rate/ramp/burst/sustained/soak modes against the real gateway, plus a metrics-collector module that reads worker Prometheus output and Postgres/Neon telemetry concurrently with each run.

## Related

- [Discovered architecture](00-discovered-architecture.md)
