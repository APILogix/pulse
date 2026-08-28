# 10 — Multi-tenant results

# NOT MEASURED

No multi-tenant benchmark run has been executed.

## What this will test, once executed

Per spec §20, three concurrently-active tenants at different offered volumes (low/medium/high), verifying:

1. One tenant cannot consume all write-admission permits.
2. One tenant cannot monopolize DB connections.
3. Queue starvation does not occur for the low-volume tenant.
4. Fairness controls (`TENANT_INFLIGHT_LIMIT`, `queue/ingest-queues.ts:99-106`) remain active — never disabled to "increase" measured throughput.
5. The low-volume tenant retains reasonable latency even while the high-volume tenant is at its own saturation point.

## How this must be run to be valid evidence

Each tenant must be a **genuinely distinct organization** (distinct `organizationId`), not a shared API key with a `tenantId` field in the payload — the real `WorkerRegistry` fairness gate keys off the pg-boss job's `organizationId`, not an application-level tag. [`provision-benchmark-fixture.ts`](../../../scripts/bench/provision-benchmark-fixture.ts) creates one full organization/project/environment/API-key set per `--tag`, so three tags produce three real, independently-resolved tenants. See the exact recipe in [`03-workload-profiles.md`](03-workload-profiles.md).

Each tenant's generator must run as an **independent process** (not sequential calls in one process), because fairness contention only exists when jobs from multiple organizations are genuinely in flight in the worker at the same time.

## What to measure once real output exists

| Metric | Where it comes from |
| --- | --- |
| Per-tenant accepted/durable rate | Each tenant's own JSON report (`acceptedEvents`, worker sample `eventsInsertedByType` — note this metric is NOT currently org-scoped in the worker's Prometheus export, so per-org durable rate requires either a DB-side query filtered by a benchmark tag, or accepting that this metric can only be read in aggregate across all tenants sharing a worker process). |
| Per-tenant p95/p99 latency | Each tenant's own `latencyQuantiles` / outcome set. |
| Fairness deferral count | `fairnessDeferredJobsTotal` in worker samples (now parsed; compute delta across the run window). |
| Starvation-guard admissions | `fairnessStarvationGuardAdmissionsTotal` in worker samples (now parsed). |

## Known gap in this framework — CLOSED during this session

[`metrics-collector.ts`](../../../scripts/bench/metrics-collector.ts) initially parsed queue depth, write-admission, DB pool, and per-type counters but not the fairness-specific counters. This was found while writing this report and fixed in the same session: `WorkerSample` now includes `fairnessDeferredJobsTotal`, `fairnessProcessedJobsTotal`, `fairnessStarvationGuardAdmissionsTotal`, and `orgInFlightJobs` (keyed by `org_id` label), parsed from `ingest_fairness_deferred_jobs_total`, `ingest_fairness_processed_jobs_total`, `ingest_fairness_starvation_guard_admissions_total`, and `ingest_org_inflight_jobs` respectively. These are cumulative counters/process-local gauges — compute deltas across the run window for a per-interval deferral rate, and remember `orgInFlightJobs` reflects only the worker process(es) the collector is scraping, not a fleet-wide total.

## Related documents

- [Workload profiles](03-workload-profiles.md)
- [Worker capacity](07-worker-capacity.md)
- [Bottleneck analysis](05-bottleneck-analysis.md)
