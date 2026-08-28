# 05 — Bottleneck analysis

# NOT MEASURED

No benchmark run has been executed. This report documents HOW bottleneck attribution will be performed once real data exists, and what candidate bottlenecks the architecture audit flags as plausible — explicitly labeled as candidates, not findings.

## Attribution method (spec §12: prove correlation, don't guess)

For each ramp/sustained step, [`sustainability.ts`](../../../scripts/bench/sustainability.ts) records which criteria were violated and the exact measured values. Bottleneck attribution must cross-reference:

1. Did throughput (accepted or durable rate) stop increasing with offered rate?
2. At the same step, which resource signal was closest to its configured/observed ceiling?
   - `writeAdmissionInFlight` ≈ `writeAdmissionPermits` → DB write-admission is saturated.
   - `dbPoolWaiting[pool] > 0` sustained → connection pool is saturated (distinct from admission).
   - `activeConnections / totalConnections` (DB samples) near 90%+ → Postgres connection ceiling.
   - `queueDepthPending` growing while `queueDepthActive` is flat → workers are not draining fast enough (could be CPU, DB latency, or fairness deferral — needs further breakdown).
   - Latency dominated by one particular event type in a mixed profile → that type's write path (e.g. trace expansion, error grouping) is the localized bottleneck, not the system as a whole.
3. Only label a resource "the bottleneck" when (a) it was near saturation AND (b) throughput plateaued or latency inflected AT THE SAME STEP. A resource merely being "high" without a corresponding throughput/latency inflection is not sufficient evidence.

## Candidate bottlenecks flagged by the architecture audit (unverified until measured)

| Candidate | Why it's plausible | Where to look once data exists |
| --- | --- | --- |
| DB write-admission (16 permits) | Hard configured ceiling on concurrent Log DB transactions per process | `writeAdmissionInFlight` vs `writeAdmissionPermits` in worker samples |
| Trace payload replication (O(S²)) | Every derived span row copies the complete parent trace payload | Compare `trace-heavy`/`worst-case` profile latency and DB samples against `mixed` at the same offered rate |
| Error grouping merged-fallback path | Documented O(N) fallback when a matched error group has been merged | Compare `error-heavy` profile p99 against `request-heavy` at equal offered rate |
| Per-process fairness ceiling under multi-tenant load | `TENANT_INFLIGHT_LIMIT` bounds one org's concurrent in-flight jobs per worker process | Compare low-tenant vs high-tenant latency in the multi-tenant recipe ([`10-multitenant-results.md`](10-multitenant-results.md)) |
| Backpressure shedding threshold (100k/250k pending) | Advisory, plan-aware; only engages at very high queue depth | Only relevant once `queueDepthPending` from worker samples actually approaches these levels |
| Postgres connection ceiling (Neon plan-dependent) | Unknown current plan config (see [`06-database-capacity.md`](06-database-capacity.md)) | `dbSamples[].totalConnections` vs the actual Neon plan's advertised limit |
| Duplicate-key detection cost (typed `ON CONFLICT DO NOTHING`) | Every insert pays the unique-index lookup even for non-duplicates | Compare `duplicate-heavy` (0% and 70% ratio runs) against `mixed` at equal offered rate |

None of these is confirmed. Each requires a same-offered-rate comparison against a baseline profile before it can be called a bottleneck.

## Related documents

- [Current capacity](04-current-capacity.md)
- [Database capacity](06-database-capacity.md)
- [Worker capacity](07-worker-capacity.md)
- [Saturation analysis](11-saturation-analysis.md)
