# Worker memory

Status date: 2026-08-27. This is a source-derived envelope, not an RSS measurement.

## In-process domains

| Domain | Classification | Bound/status |
| --- | --- | --- |
| Delivered typed job payloads | **DERIVED** | Up to 80 jobs/process by default; normal job serialized event data about 1 MiB each. |
| Delivered DLQ payloads | **DERIVED** | Up to 20 jobs by default; normal source payload envelope about 20 MiB, but retained/manual payload variants were not profiled. |
| Admission waiters | **DERIVED** | At most the delivered typed work not holding permits; up to 64 at the 80/16 defaults. |
| Active transactions | **MEASURED** | 16 permits by default. |
| Trace normalization/writer state | **MEASURED/DERIVED** | Iterative and node/depth bounded, but each span currently repeats the full parent trace payload for persistence. |
| Fairness map | **DERIVED** | Active organizations within currently delivered work; cleared in `finally`. |
| UsageCounter map | **DERIVED** | Threshold-triggered at 10,000 entries, but not a strict bound during DB failure. |
| Pool clients | **MEASURED** | Dedicated write max 20; Primary ingestion max 8; pg-boss has its configured queue pool. |

## Normal-path raw-payload envelope

**MEASURED:** normal gateway jobs are capped at 200 events, about 1 MiB serialized event data, and 256 KiB/event.

**DERIVED:** 80 typed jobs × about 1 MiB gives an approximately 80 MiB raw serialized-event envelope per ingestion process. Twenty DLQ jobs can add approximately 20 MiB on the normal source-job shape.

This is not a heap/RSS ceiling. It excludes:

- JavaScript object/array overhead and pg-boss metadata;
- raw plus Zod-normalized copies;
- null-prototype trace clones and traversal stacks;
- SQL row arrays, placeholder/value arrays, and serialized JSON strings;
- pg client buffers and sockets;
- logs/metrics/profile aggregation;
- V8 heap fragmentation and garbage-collection headroom; and
- usage-map entries retained during failed staging.

## Admission memory

**MEASURED:** `AdmissionWaiter` records hold state, resolver/rejector closures, and an optional signal listener.

**DERIVED:** under current active wiring, the admission queue is bounded by typed jobs already delivered to callbacks. At defaults, at most 64 wait after 16 of 80 hold permits. The durable pg-boss backlog can grow without a hard capacity, but it is not materialized wholesale in this waiter array.

**MEASURED:** cancellation removes a queued waiter synchronously and removes its listener; the acquire/continuation race releases the permit. This prevents stale waiter/closure accumulation from expired jobs.

## Trace memory and write amplification

- **MEASURED:** validation is iterative, capped at 10,000 actual nodes and depth 128, and rejects cycles/shared references.
- **MEASURED:** normalization clones span objects before DB checkout.
- **MEASURED:** derived span rows are built/flushed in bind-safe chunks of at most 978 rows.
- **MEASURED:** each derived row serializes `payloadFor(event)`, the complete normalized parent trace.
- **DERIVED:** parent payload replication is O(S²) in total copied payload when parent size grows with span count. Peak memory, serialization cost, storage, and WAL were not measured.
- **DECISION:** payload narrowing is deferred because unified analytics search applies `payload::text ILIKE` to spans; current-span-only payload would change behavior.

## UsageCounter failure-mode memory

**MEASURED:** `bufferLimit` defaults to 10,000 keys and triggers a background flush; it is a threshold, not an eviction cap.

**MEASURED:** one authoritative flush swaps out a snapshot while new increments enter a replacement map. If staging fails, the snapshot is merged back exactly once and the failure rejects.

**DERIVED:** during prolonged database failure, newly arriving distinct organization/project/API-key/event-type/counter keys can push cardinality beyond 10,000. The code intentionally retains and reports overflow rather than dropping billable usage. Therefore a strict failure-mode memory bound is not proven.

## Pool memory

| Pool | Default max | Qualification |
| --- | ---: | --- |
| Dedicated Log DB write | 20 | At most 16 ingestion transactions; reserved headroom may service backend cancellation/control checkout. |
| Primary ingestion | 8 | Usage staging, DLQ persistence, and control work. |
| pg-boss | Configured separately | Queue delivery/scheduling; exact provider/client memory not measured. |

Connection object counts are bounded by pool settings, but memory per connection and provider buffering were not measured.

## Shutdown

**MEASURED:** shutdown stops local rollup work, drains source/DLQ workers, then calls processor/usage stop before pools close when startup completed.

**MEASURED:** `UsageCounter.stop()` joins active work and retries a re-buffered final drain. `WorkerRegistry.stop()` still catches/logs a processor-stop failure, so supervisor-visible shutdown success does not prove billing drain success.

**DERIVED:** a forced PM2 termination reclaims process memory but can leave post-COMMIT usage unpersisted; it is not a memory-safety or billing-durability mechanism.

## Acceptance status

| Gate | Status |
| --- | --- |
| Normal raw-payload envelope derived | **MET (DERIVED)** |
| Admission waiter leak tests | **MET** |
| Total RSS/heap under sustained mixed load | **UNMET** |
| 10,000-node trace peak memory | **UNMET** |
| Strict bound during prolonged usage-staging outage | **UNMET** |
| Worker restart/OOM behavior under load | **UNMET** |

# BENCHMARK NOT EXECUTED

## Related documents

- [Worker concurrency](worker-concurrency.md)
- [Backpressure](worker-backpressure.md)
- [Trace ingestion](../ingestion/trace-ingestion.md)
- [Capacity model](../performance/capacity-model.md)
- [Failure recovery](../operations/failure-recovery.md)
