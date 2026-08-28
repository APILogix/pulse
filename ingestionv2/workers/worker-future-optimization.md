# Worker future optimization

Status date: 2026-08-27

## Prerequisite: no optimization without evidence

**UNVERIFIED:** No committed ingestion benchmark was executed. No throughput, latency, CPU, memory, or WAL measurement exists. All items below are evidence-gated — they describe directions, not authorized changes.

**DERIVED:** Implementation of any optimization requires:
1. A safe isolated benchmark environment (not production connections).
2. Executed baseline measurement.
3. Committed candidate measurement.
4. Before/after comparison.
5. Rollback plan.

## Optimization candidates by evidence ranking

### 1. Error merged-group fallback (O(N) SQL path)

| Classification | Detail |
| --- | --- |
| **DERIVED** | The merged error-group fallback is `~3N + merge-chain hops + constant` SQL operations — the clearest source-level N-scaling path. |
| **DERIVED** | Possible mitigation: batch group operations, materialized view, or recursive-CTE reduction. |
| **UNKNOWN** | Frequency of merged-group fallback in production traffic. |
| **UNKNOWN** | Actual execution time contribution. |

### 2. Partial-duplicate outbox write amplification

| Classification | Detail |
| --- | --- |
| **DERIVED** | Non-error mixed new/duplicate batches pass the complete scoped list to outbox reservation whenever at least one typed row is inserted. |
| **DERIVED** | This causes write/WAL amplification for duplicates (unnecessary outbox/idempotency work). |
| **MEASURED / PARTIAL** | Outbox reservation preserves duplicate alert handoff final state. Typed-row convergence still depends on a deployed unique guard; the intended log guard is not live. |
| **UNKNOWN** | Actual duplicate rate in production traffic. |

### 3. Fairness re-enqueue WAL amplification

| Classification | Detail |
| --- | --- |
| **DERIVED** | Each fairness deferral produces an additional Primary DB queue write (job send). |
| **DERIVED** | Under burst/overload with many over-budget orgs, this amplifies Primary DB WAL. |
| **UNKNOWN** | Production deferral rate. |
| **UNKNOWN** | WAL volume contribution from deferrals vs. normal queue operations. |

### 4. Queue partition pruning

| Classification | Detail |
| --- | --- |
| **MEASURED** | Current state: `partition=false` on all queues. Source requests `partition=true`. |
| **MEASURED** | Without partitioning, all queue operations scan `pgboss.job_common` (111K+ live tuples at audit). |
| **DERIVED** | Enabling partitioning could reduce scan scope for delivery operations. |
| **MEASURED** | Destructive operation: requires delete + recreate of each queue (retained job loss risk). |

### 5. Connection pooling optimization

| Classification | Detail |
| --- | --- |
| **DERIVED** | Default reserve (2 connections for non-transaction use) is conservative. Under high utilization, those 2 connections may be insufficient for health probes + maintenance. |
| **DERIVED** | Under low utilization, the reserve is unused capacity but does not itself prove a throughput loss; under saturation it reduces the transaction ceiling to retain operational/cancellation headroom. |
| **UNKNOWN** | Whether a dynamic or adaptive reserve would be beneficial. |

### 6. Batch size and concurrency tuning

| Classification | Detail |
| --- | --- |
| **MEASURED** | Current defaults: `INGESTION_TYPE_WORKER_CONCURRENCY=2`, `INGESTION_TYPE_WORKER_BATCH_SIZE=4`. |
| **DERIVED** | Larger batches increase throughput per handler invocation but increase per-handler memory and wall time (increasing abort risk from pg-boss expiry). |
| **DERIVED** | Optimal values depend on payload sizes, DB response times, and abort thresholds — require empirical measurement. |
| **UNKNOWN** | Actual payload size distribution and handler wall time distribution. |

### 7. Usage accounting durability

| Classification | Detail |
| --- | --- |
| **DERIVED** | Closing the process-crash window: transactional insert or write-ahead entry tied to the telemetry commit. |
| **DERIVED** | Closing the PostgreSQL-crash window: logged (not UNLOGGED) staging table, at the cost of WAL amplification. |
| **UNKNOWN** | Actual loss rate from either window. |
| **UNKNOWN** | WAL cost of logged staging vs. probability × impact of usage loss. |

### 8. Fleet-wide fairness coordination

| Classification | Detail |
| --- | --- |
| **DERIVED** | Current per-process limits multiply with worker count. A shared coordination mechanism (e.g., PostgreSQL advisory lock or counter) could enforce global limits. |
| **DERIVED** | Trade-off: coordination adds latency/complexity to every job. |
| **UNKNOWN** | Whether per-process fairness is insufficient in practice. |

## Items explicitly not optimizable without evidence

| Classification | Item | Why blocked |
| --- | --- | --- |
| **UNVERIFIED** | Pool size increases | No concurrent workload evidence. Pool increase without demand evidence moves contention to PostgreSQL. |
| **UNVERIFIED** | Timeout tuning | No production timeout frequency data. Reducing timeouts risks premature failures. |
| **UNVERIFIED** | Concurrency increases | Without knowing current saturation, adding concurrency may not improve throughput. |
| **UNKNOWN** | Index modifications | `statsResetAt` unknown; no observation window for index usage. |

## Monitoring prerequisites for optimization

Before any optimization can be evaluated, the following data must be collected:

| Classification | Data needed |
| --- | --- |
| **UNKNOWN** | `writeAdmissionWaitMs` p50/p95/p99 under production load. |
| **UNKNOWN** | `dbConnectionWaitMs` p50/p95/p99 under production load. |
| **UNKNOWN** | Per-type processing time distribution. |
| **UNKNOWN** | Fairness deferral rate per org/tier. |
| **UNKNOWN** | Duplicate event rate per signal type. |
| **UNKNOWN** | Trace size distribution (node count, depth). |
| **UNKNOWN** | Error merged-group frequency. |
| **UNKNOWN** | Queue drain rate vs. enqueue rate. |
| **UNKNOWN** | WAL volume attribution (typed inserts vs. queue operations vs. usage staging). |
| **UNKNOWN** | Heap and RSS under sustained load. |



### 9. Trace-derived span payload replication

| Classification | Detail |
| --- | --- |
| **MEASURED** | Every derived span serializes the complete normalized parent trace through `payloadFor(event)`. |
| **DERIVED** | Total copied payload is structurally O(S²) when parent trace size grows with span count. |
| **MEASURED** | Unified analytics search uses span `payload::text`, so current-span-only payload changes search semantics. |
| **DEFERRED** | Implement only behind an explicit payload/search contract or feature/version gate, with compatibility and WAL/storage benchmarks. |

### 10. Hard queue/API capacity controls

| Classification | Detail |
| --- | --- |
| **MEASURED** | 100k/250k queue thresholds are reactive and high-urgency traffic can continue at critical depth. |
| **MEASURED** | `IngestionRateLimiter`, tenant rate settings, and `API_MAX_CONCURRENCY` are not active structural bounds on this path. |
| **UNKNOWN** | Appropriate hard capacity and tenant budgets; require real traffic distribution and overload-recovery evidence. |

### 11. Maintenance-topology correction

| Classification | Detail |
| --- | --- |
| **MEASURED** | Telemetry maintenance uses the Primary DB and legacy unprefixed table names while active telemetry is in Log DB `events_*` tables. |
| **UNVERIFIED** | Correct pool/table wiring, partition creation, and retention behavior require clone rehearsal; default partitions already contain data. |

### 12. Failure-mode memory bound

| Classification | Detail |
| --- | --- |
| **DERIVED** | Normal delivered-job/admission envelopes are bounded, but UsageCounter distinct-key cardinality can exceed its threshold during prolonged staging failure. |
| **UNKNOWN** | A safe overflow strategy that preserves billing and imposes a strict memory cap. Do not drop usage increments silently. |

## Phase-22 decision rule

For horizontal scaling, queue partitioning, event-type isolation, adaptive batches/concurrency, dynamic backpressure, tenant-aware scheduling, or DB-aware admission, record: trigger signal, bounded threshold, expected benefit, cost, correctness risk, rollback, and why current evidence is insufficient. None is authorized by this document.

## Related documents

- [Worker concurrency](worker-concurrency.md)
- [Worker fairness](worker-fairness.md)
- [Worker backpressure](worker-backpressure.md)
- [Worker memory](worker-memory.md)
- [Remaining bottlenecks](../roadmap/remaining-bottlenecks.md)
- [Benchmark methodology](../performance/benchmark-methodology.md)
