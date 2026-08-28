# Ingestion benchmark methodology

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

No isolated benchmark database exists. The available endpoints are production resources, and even transaction rollback generates queries, WAL-related work, sequence advancement, statistics, locks, and dead tuples. Processor mode can commit durable typed/outbox/usage/queue state. Therefore no live case was run.

## Mandatory entrypoint and recorded dry-runs

The required orchestrator is:

```powershell
npm run bench:ingestion:matrix
```

Only plan generation was used:

| Artifact | Planned | Completed | Meaning |
| --- | ---: | ---: | --- |
| `artifacts/ingestion-phase2/benchmark-acceptance-plan.json` | 3,564 | 0 | acceptance matrix commands generated |
| `artifacts/ingestion-phase2/pre-change-benchmark-plan.json` | 12 | 0 | pre-change smoke commands generated |
| `artifacts/ingestion-phase2/post-change-benchmark-plan.json` | 12 | 0 | post-change smoke commands generated |

All are dry-run plans. `passed=true` proves plan generation only, not throughput, latency, safety, or improvement.

## Safety gate before execution

Every item is mandatory:

1. dedicated disposable Primary/pg-boss and Log DB resources, not production or a production branch;
2. explicit environment allowlist plus independent host/database/account fingerprint check;
3. credentials handled locally without committing/logging secrets;
4. no real customer data; deterministic synthetic tenant/project/event fixtures;
5. exact commit, working-tree hash/provenance, Node/dependency/config versions;
6. capacity/connection budget approved for both endpoints;
7. committed-row cleanup/rebuild procedure rehearsed, including typed rows, outbox/idempotency, groups/history, usage staging/rollups, DLQ, and pg-boss jobs;
8. stop conditions and operator ownership; and
9. proof that legacy child commands cannot silently target production.

A rollback flag is not a substitute for isolation.

## Distinguish workload layers

The generated 3,564-cell plan varies type, direct-writer batch size, tenants, a concurrency input, and traffic profile. It is not automatically acceptance-ready:

- direct writer mode bypasses the real HTTP gateway, pg-boss callback batching, fairness, cancellation, and WorkerRegistry;
- values above the normal gateway limit of 200 are internal stress cases, not supported ingress batches;
- its concurrency axis must not be called worker concurrency unless it runs through actual workers;
- command generation does not provide warmup, statistical repetition, cleanup proof, or failure injection; and
- matrix size alone does not establish coverage quality.

Use separate labelled suites: HTTP/queue end-to-end, WorkerRegistry/pg-boss, direct-writer microbenchmark, database forensics, and failure/chaos. Never merge their results without preserving mode.

## Required scenarios

| Suite | Cases |
| --- | --- |
| Normal ingress | each of ten types plus mixed; 1/10/50/100/200 events; representative byte sizes |
| Duplicate behavior | 0/partial/high/all duplicate; errors and non-errors; outbox reservation work |
| Trace | node/depth boundaries, 978/979 derived rows, large allowed payloads, search contract variants |
| Error | all duplicate, new/existing/mixed/regression, merged-group fallback |
| Fairness | multiple plan tiers/organizations across multiple worker processes, sustained noisy neighbor |
| Cancellation | abort during fairness, admission, checkout, active query, before/during COMMIT, rollback |
| Durability | process kill, DB disconnect/restart/failover, redelivery, UsageCounter staging/rollup windows |
| Backpressure | mixed queues, increasing arrival rate, drain/recovery, DLQ replay |
| Compression | valid gzip, malformed streams, compressed/expanded boundary and memory behavior |
| Sustained resource | long enough to observe RSS/heap/GC, pool/backends, WAL/checkpoints, autovacuum/dead tuples |

## Protocol

Before execution, preregister warmup length, measured duration, repetition count, randomization/order, seed data, outlier policy, stop conditions, and statistical comparison. Do not discard high-error repetitions merely because they exceed a convenient error threshold; retain and classify every attempted run. Mark interrupted/invalid instrumentation separately with a reason.

Baseline and candidate must use the same topology, data seed, configuration, runner version, sampling, and run order strategy. Capture cold and warm behavior separately where relevant. Reset/recreate the disposable environment or prove cleanup between incompatible cases.

## Metrics per case

- accepted/received/inserted/duplicate/rejected/failed events and bytes per second;
- end-to-end and stage latency distributions with sample count;
- queue depth/oldest age/drain rate/retries;
- process CPU, RSS, heap, GC, event-loop delay, restart/OOM;
- pool admission/checkout and endpoint total/active/idle/waiting sessions;
- query duration/count, locks/deadlocks/timeouts, commits/rollbacks;
- WAL bytes/records, checkpoints, relation/index/TOAST/dead-tuple deltas;
- per-tier/organization throughput, wait, deferral, starvation-guard admissions; and
- correctness reconciliation across input, typed rows, outbox, usage, and redelivery.

Report raw numerator/denominator and uncertainty, not percentiles without sample counts.

## Acceptance gates

Absolute correctness gates are non-negotiable:

- no ACK before durable COMMIT;
- no typed/outbox atomicity break;
- retry convergence for every deployed identity guard;
- inserted-only billing reconciliation;
- no leaked pool clients/permits/admission waiters;
- no post-abort SQL except rollback;
- no cross-tenant scope violation;
- no unapproved persistent residue; and
- no OOM/restart or exceeded approved DB connection budget.

Performance regression/improvement margins, latency SLOs, maximum memory, queue-age limit, error budget, and fairness share must be approved and preregistered from product/infrastructure requirements. This audit does **not** invent `5%`, `5 ms`, `358 MB`, `80%`, or similar gates. If no approved threshold exists, report the measured difference and mark acceptance undecided.

## Evidence bundle

Retain environment fingerprint/provenance, exact commands/config, all attempted case manifests, raw worker/DB/process/queue samples, baseline/candidate summaries, correctness reconciliation, failure logs, cleanup verification, and comparator methodology. A partial matrix cannot be relabelled complete.

## Root-cause matrix

| Evidence | Problem | Root cause | Impact | Required correction | Status |
| --- | --- | --- | --- | --- | --- |
| MEASURED | live benchmark unsafe | only production endpoints available | production load/data side effects | isolated disposable DBs | **BLOCKED** |
| MEASURED | dry-run looks successful | `passed` means command generation | false performance claim | preserve completed=0 and verdict | satisfied in docs |
| MEASURED | matrix axis mislabeled | writer mode bypasses workers | invalid concurrency/fairness inference | split benchmark modes | **UNMET** |
| MEASURED | prior gates arbitrary | no SLO/baseline authority | false accept/reject | preregister approved gates | **UNMET** |
