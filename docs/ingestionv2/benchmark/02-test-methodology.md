# 02 — Test methodology

Status: methodology defined and implemented; **no run has been executed against any target**.

## Capacity definition used

Per spec §9, capacity is **never** computed as `worker concurrency × batch size`. This framework tracks five distinct rates per run:

1. **Offered rate** — events the generator attempted to send (`events` array length per request).
2. **Accepted rate** — events the gateway's `202` response reports as `accepted` (successfully enqueued to pg-boss; **not** durably committed — see below).
3. **Durable/inserted rate** — events the worker actually committed, derived from the delta of `ingest_events_inserted_by_type_total` (Prometheus counter) across the run window. Requires `--worker-metrics-url`.
4. **Failed rate** — HTTP non-2xx responses or transport errors (`error !== null` in `RequestOutcome`).
5. **Duplicate rate** — events the generator deliberately resent with a reused `eventId` (`duplicatesSent`), tracked separately from rejects.
6. **Queue accumulation rate** — derived from `ingest_queue_depth_pending` deltas across worker samples; a positive, sustained slope indicates the offered rate exceeds durable drain rate.

"Sustainable capacity" = the highest **durable completed events/second** at which every applicable criterion in [`sustainability.ts`](../../../scripts/bench/sustainability.ts) evaluates to `met` (never `violated`; `unmeasured` criteria are reported but do not themselves block a "sustainable" verdict, since this benchmark cannot invent telemetry that isn't reachable).

## Modes

| Mode | Purpose | Destructive? |
| --- | --- | --- |
| Baseline | Very low, fixed traffic (~1 event/sec). Per-batch/per-event overhead only. | No |
| Fixed-rate | Constant offered rate for a fixed duration. | No, at conservative rates |
| Ramp | Step offered rate upward through a configured list until a step violates sustainability, then stop and run a recovery check. | Potentially, by design |
| Burst | Alternating high-volume/quiet cycles; measures absorption + queue drain between bursts. | Potentially |
| Sustained | One fixed (typically elevated) rate for a long window; exposes connection exhaustion, memory growth, WAL pressure. | Potentially |
| Soak | Same mechanics as sustained, intended for multi-hour runs; adds a queue-depth degradation-trend heuristic. | Potentially |

Ramp/burst/sustained/soak are unconditionally refused by `assertSafeTarget()` against any URL whose hostname matches a production-looking pattern — no override flag unlocks them. Baseline/fixed-rate may run against a production-looking URL only with the explicit `--i-understand-this-may-affect-production` flag, and even then the operator is responsible for keeping the rate low and the profile non-destructive (this is documented, not enforced server-side, since the generator cannot know your production capacity a priori).

## Batch size sweep

Per spec §7, batch sizes tested must be discovered from code, not assumed. Confirmed from `src/config/env.ts`:

| Level | Value | Source |
| --- | ---: | --- |
| Minimum | 1 event | N/A (any positive integer accepted) |
| Small | 10 events | operator choice |
| Medium | 100 events | operator choice |
| Normal (job chunk size) | 200 events | `INGESTION_JOB_CHUNK_SIZE`, `env.ts:309` |
| Maximum (HTTP batch cap) | 1000 events | `INGESTION_MAX_BATCH_SIZE`, `env.ts:216` |

**Correction to earlier documentation:** the ingestion audit's `ingestionv2/` documentation previously described "200 events" as the batch cap; that is the pg-boss job chunk size the gateway splits into per type, not the HTTP request-level limit. The actual HTTP-level ceiling is 1000 events per request; requests above 200 events of one type will be split into multiple pg-boss jobs by the gateway (`service.ts:835-869`). The `--batch-size` CLI flag controls events per HTTP request, not job chunk size directly — the two only coincide when `--batch-size` ≤ 200.

## Sustainability criteria implemented

From [`sustainability.ts`](../../../scripts/bench/sustainability.ts), evaluated per step/interval:

| Criterion | Measured from | Threshold source |
| --- | --- | --- |
| Error rate | HTTP outcomes | `DEFAULT_SLO.maxErrorRatePct = 1%` (operator-overridable; not a production SLO, a benchmark default) |
| p95 latency | Successful request latencies | `DEFAULT_SLO.maxP95LatencyMs = 2000ms` (same caveat) |
| p99 latency | Successful request latencies | `DEFAULT_SLO.maxP99LatencyMs = 5000ms` (same caveat) |
| Queue oldest-pending age | `ingest_queue_oldest_pending_job_age_ms` | `DEFAULT_SLO.maxQueueOldestAgeMs = 60000ms` |
| Queue depth not continuously increasing | `ingest_queue_depth_pending` trend over N samples | `DEFAULT_SLO.maxConsecutiveQueueGrowthSamples = 5` |
| DB connection utilization | `pg_stat_activity` active/total | `DEFAULT_SLO.maxDbConnectionUtilizationPct = 90%` |

**These defaults are benchmark defaults, not a production SLA.** They must be reviewed and overridden (`SloConfig` in `sustainability.ts`) before any capacity number derived from them is treated as a production commitment.

## What is measured vs. inferred vs. assumed

| Category | Examples in this framework |
| --- | --- |
| Measured (once executed) | HTTP response codes, latencies, `accepted`/`rejected` counts, worker Prometheus counter deltas, `pg_stat_activity` snapshots. |
| Derived | Sustainability verdicts (computed from measured samples via documented arithmetic); saturation rate (the first ramp step that violates a criterion). |
| Explicitly not measured until executed | Every specific throughput/latency/percentile number in reports 04-14. |
| Never assumed | Neon compute size/connection limits (report 06), any percentage improvement from an upgraded plan (report 13), any recommended production ceiling (report 14) until a saturation rate is actually observed. |

## Repetition and duration policy

Not yet exercised with real repetitions. The intended policy (to be followed once execution begins): run each ramp/sustained configuration at least once to establish a first data point; repeat at least 3 times before treating any single-run number as representative, consistent with the existing direct-DB harness's repetition-filtering pattern (`scripts/lib/aggregate.js`). This framework does not yet auto-repeat ramp/sustained/soak runs — that is listed as follow-up work in [`15-regression-benchmark.md`](15-regression-benchmark.md).

## Related documents

- [Benchmark overview](01-benchmark-overview.md)
- [Workload profiles](03-workload-profiles.md)
- [Discovered architecture](00-discovered-architecture.md)
