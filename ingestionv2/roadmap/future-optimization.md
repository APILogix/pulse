# Future optimization decision register

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

Nothing in this register is authorized. “Threshold unset” is intentional: no SLO/workload baseline exists, so inventing a number would violate the evidence requirement. An owner must preregister each threshold before an experiment.

## Phase-22 worker, queue, and topology candidates

| Candidate | WHEN TO CONSIDER | SIGNAL | THRESHOLD | EXPECTED BENEFIT | COST | RISK | WHY NOT NOW |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Horizontal worker scaling | One process cannot drain accepted load after safer tuning | oldest queue age/drain deficit + process CPU, with DB/memory headroom | **Unset:** approved queue-age SLO breached for preregistered windows while DB/RSS remain below approved limits | more normalization/drain capacity | more processes, pools, usage buffers, operations | multiplies connections and process-local fairness limits | no single-process load ceiling or multi-replica fairness test |
| Queue partitioning | Shared pg-boss table work is proven material | queue SQL time/CPU/scans and retained-row growth | **Unset:** queue work exceeds approved DB budget and clone shows a winning safe layout | smaller/prunable queue scope | migration/rebuild, archive/replay, operational complexity | retained-job loss and outage if conversion fails | retained rows exist; no archive/replay or clone rehearsal |
| Event-type isolation | One signal materially harms others | per-type CPU/GC/queue wait/error correlation | **Unset:** cross-type SLO breach causally attributable and isolated design passes regression gate | fault/resource isolation | extra services, pools, deploys | capacity fragmentation and changed fairness | interference not measured |
| Adaptive batch sizing | Fixed callback size misses latency/memory/throughput objectives | bytes/events per job, handler wall time, expiry, heap | **Unset:** candidate wins preregistered multi-metric gate across payload classes | adapt overhead versus memory/wall time | controller/state/testing | larger shared-signal blast radius and expiry risk | no size/wall-time distributions or isolated matrix |
| Adaptive concurrency | Static slots fail across stable load regimes | admission/pool wait, DB CPU/backends, RSS, queue age | **Unset:** stable control inputs predict capacity and candidate passes oscillation/fairness gates | use available headroom without static overprovision | controller and safeguards | oscillation, retry storm, DB overload, fairness shifts | no calibrated SLOs or synchronized resource evidence |
| Dynamic backpressure | Current reactive shedding recovers too late | arrival/drain ratio, oldest age, DB/RSS pressure, rejection mix | **Unset:** overload recovery violates approved SLO and policy is product-approved | earlier overload containment | policy/config/client contract work | wrong shedding loses high-value telemetry or discriminates tiers | no hard capacity model or recovery tests |
| Tenant-aware scheduling | Process-local fairness fails at fleet scale | per-org/tier throughput, wait, deferrals across replicas | **Unset:** approved minimum share/starvation objective violated in multi-process test | fleet-wide noisy-neighbor control | shared coordination and cardinality | coordination latency/failure can block all tenants | no fleet fairness benchmark or approved fairness objective |
| Database-aware admission control | DB pressure is predictable before failure | DB CPU/backends/locks/commit latency and pool/admission state | **Unset:** signal reliably predicts approved saturation boundary with low false actions | reject/defer before DB collapse | provider integration, sampling/controller | stale/noisy metrics can oscillate or underutilize DB | no synchronized workload/DB time series |
| Autoscaling | Load varies enough that fixed replicas miss SLO or waste material capacity | queue age/drain, CPU/RSS, cooldown/restart behavior | **Unset:** policy meets approved SLO/cost/recovery gates in isolated multi-replica test | elastic capacity/cost | orchestrator, warmup, cooldown, observability | connection spikes, duplicated local limits, thrash | scaling and fairness semantics untested |
| Workload prioritization | Current tier/type urgency conflicts with product SLOs | per-tier/type queue age, rejection, business impact | **Unset:** product-approved SLO repeatedly violated under controlled mixed load | align scarce capacity with value | policy governance and compatibility | starvation or plan-contract regression | current weights lack workload/product validation |
| Hot-tenant isolation | One tenant dominates resources despite fairness | per-org bytes/jobs/CPU/queue age and starvation guard | **Unset:** tenant exceeds approved share and causes another tenant's SLO breach | contain noisy neighbors | routing/queues/capacity fragmentation | tenant misclassification, idle silos | no fleet-level causal evidence or tenant budget |
| Burst handling | Known bursts exceed steady drain but are recoverable | arrival peak, backlog age, recovery time, memory/DB headroom | **Unset:** approved burst envelope cannot recover within SLO | predictable surge absorption | reserved capacity/queue policy/client controls | shifts overload to DB/memory or extends backlog | burst distributions and recovery curve absent |
| Retry-storm protection | DB incidents create self-amplifying retries | retry rate/age, DB recovery, lock/timeout classes | **Unset:** retries consume approved fraction of recovering capacity or delay new work beyond SLO | faster stable recovery | backoff/jitter/budget logic | excessive delay or starvation; changed delivery timing | no chaos/recovery measurements |
| DLQ strategy evolution | Manual retained-DLQ handling misses operational objectives | retained count/age, replay success, operator time | **Unset:** approved retention/recovery SLO breached with a tested source of truth | safer bounded replay/retention | tooling, storage, governance | accidental replay/deletion or identity drift | no approved retention/archive/reconciliation policy |
| Telemetry partitioning | Relation growth/pruning/vacuum evidence justifies dated leaves | size, query pruning, insert/DDL locks, default rows | **Unset:** approved storage/query/maintenance budget breached and clone plan passes | pruning and lifecycle control | DDL, row movement, catalog/ops | blocking, misrouting, retention deletion | default partitions contain data; maintenance targets wrong topology |
| Archival | Product/compliance retention and storage/query evidence require cold data | age distribution, storage cost, query frequency, restore objective | **Unset:** approved retention/cost threshold and tested restore contract | reduce hot storage/maintenance | archive pipeline and restores | irreversible loss or unreadable history | no approved policy, format, restore test, or safe partition lifecycle |
| Sharding | One correctly tuned/partitioned DB still cannot meet measured requirements | endpoint CPU/IO/storage/connections and tenant distribution | **Unset:** single-DB capacity exhausted under approved SLO after simpler options | higher aggregate capacity/fault domains | routing, rebalancing, operations | cross-shard outbox/idempotency/billing/fairness complexity | no workload ceiling; far premature |
| Read/write separation | Reads measurably interfere with writes or require separate scaling | read/write CPU/IO/locks, replica lag, consistency needs | **Unset:** causal write-SLO impact or read-capacity breach with acceptable lag | isolate read pressure | routing/failover/lag handling | stale reads and topology complexity | current workload impact and consistency contract unmeasured |
| Database topology evolution | Provider/HA/capacity behavior fails approved objectives | failover, regional latency, endpoint limits, recovery time | **Unset:** approved availability/latency/capacity objective breached with migration plan | resilience or capacity | migration, dual operation, cost | split brain, data movement, consistency/outage | provider limits/peak/failover behavior not established |

## Write-path candidates

| Candidate | When/signal | Threshold | Expected benefit | Cost/risk | Why not now |
| --- | --- | --- | --- | --- | --- |
| Current-span-only trace payload | full-parent serialization/storage is material | **Unset:** measured resource share plus approved search/API contract | remove O(S²) copied-parent shape | versioning/backfill/search compatibility | analytics searches `payload::text`; effect unmeasured |
| Set-based merged-group resolution | fallback is non-rare/material | **Unset:** approved query/latency budget breached | remove remaining O(N) branch | complex merge/regression semantics | fallback rate unknown |
| Inserted-set non-error outbox input | partial duplicates materially amplify DB work | **Unset:** duplicate workload breaches approved DB/WAL budget | less conflict work | returning IDs can add wire/memory cost | no comparative measurement |
| Durable/replayable usage accounting | billing loss windows are unacceptable | correctness threshold is zero unexplained loss in approved failure suite | close process/UNLOGGED gaps | more WAL/transactions/reconciliation design | architecture and failure evidence incomplete |
| Bounded stable identity serialization | pathological depth risks stack/resources | **Unset:** supported input can breach approved depth/resource bound | bounded identity computation | generated-ID compatibility | no explicit compatibility/version plan |
| Log scoped unique guard | clone rehearsal and preflight pass | zero scoped duplicates, real writer drain, approved lock window | retry convergence for logs | non-concurrent parent DDL/nullable-project caveat | migration 030 not deployed or clone-rehearsed |

## Authorization checklist

A candidate needs an owner/date, measured causal symptom, explicit threshold/SLO, isolated target, baseline/candidate protocol, cleanup, correctness matrix (ACK/retry/idempotency/billing/outbox/fairness/public IDs/API/types), resource/connection/WAL/lock analysis, rollout/rollback, and independent review.

## Priority

1. close durable usage accounting and log retry-idempotency gaps;
2. obtain safe end-to-end baseline/failure evidence;
3. measure trace payload, error fallback, and partial-duplicate outbox cost;
4. repair maintenance topology only through reviewed clone rehearsal;
5. tune or scale only after those measurements.

## Related documents

- [Remaining bottlenecks](remaining-bottlenecks.md)
- [Scaling roadmap](scaling-roadmap.md)
- [Worker future optimization](../workers/worker-future-optimization.md)
- [Benchmark methodology](../performance/benchmark-methodology.md)
