# Query optimization

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

All rankings below are source-derived risk rankings, not measured runtime bottlenecks.

## Evidence-ranked query/write risks

| Rank | Classification | Finding | Disposition |
| ---: | --- | --- | --- |
| 1 | **UNKNOWN** | Runtime bottleneck ranking requires a workload. | Isolated baseline/candidate matrix. |
| 2 | **DERIVED** | Trace-derived spans each serialize the full parent trace, creating O(S²) structural payload copying. | Defer narrowing: analytics searches span `payload::text`; require compatibility gate and measurement. |
| 3 | **DERIVED** | Merged error-group fallback remains approximately `3N + constants/merge-chain hops`. | Measure frequency and server time before batching/refactor. |
| 4 | **DERIVED** | Partial-duplicate non-error batches send full scoped input to outbox reservation when at least one typed row inserts. | Require inserted identities from every writer; benchmark duplicate-heavy workloads. |
| 5 | **DERIVED** | Fairness deferral adds a Primary pg-boss write before original completion. | Measure deferral rate/WAL without weakening durability ordering. |
| 6 | **MEASURED/DERIVED** | Queue option drift and retained shared `job_common` history can increase queue work. | No destructive rebuild without archive/replay and clone evidence. |

## Statement scaling

| Path | Classification | Source-derived behavior |
| --- | --- | --- |
| Generic non-error typed batch | **DERIVED** | Set-based typed INSERT plus constant transaction/outbox work. |
| Trace-derived spans | **DERIVED** | `ceil(S/978)` span INSERT statements for `S` derived rows, plus trace header/transaction/outbox work. |
| Error normal branches | **DERIVED** | Roughly 7–12 queries depending grouping/regression branch. |
| Error merged-group fallback | **DERIVED** | Approximately `3N + merge-chain hops + constants`; only verified O(N) statement path. |
| All-duplicate non-error batch | **MEASURED** | Typed INSERT returns zero; outbox and usage work are skipped. |
| Usage rollup | **DERIVED** | Scales with organizations/projects/flush passes. |
| DLQ replay-all | **DERIVED** | Linear in replayed rows and sends. |

Query-count conventions vary on whether BEGIN/COMMIT and combined `SET LOCAL` are counted. Do not compare formulas from different conventions as benchmark results.

## Trace bind and payload behavior

- PostgreSQL bind ceiling used by the writer: 65,535 parameters.
- span row width: 67 bind values.
- safe writer chunk: `floor(65,535/67)=978` rows.
- maximum accepted trace tree: 10,000 actual nodes, depth 128.
- each derived row's final payload value is `payloadFor(event)`, which JSON-serializes the complete normalized parent trace.

**DERIVED:** chunking prevents bind overflow but does not address repeated serialization/storage. For 10,000 derived rows, SQL is split across at least 11 span INSERT statements; no latency/WAL result was captured.

**MEASURED:** unified analytics filtering applies `e.payload::text ILIKE` across event types including spans. Current-span-only payload is therefore a behavioral change, not a transparent optimization.

## Trigger/index write costs

| Classification | Finding |
| --- | --- |
| **MEASURED** | BEFORE triggers/defaults run for insert candidates before conflict suppression. |
| **DERIVED** | Duplicate candidates can consume sequence values and execute repair checks even when no typed row inserts. |
| **UNKNOWN** | Trigger CPU, sequence contention, index maintenance cost, and WAL/event under load. |
| **MEASURED** | Six exact duplicate index pairs and additional semantic overlaps were recorded. |
| **UNVERIFIED** | Full index A–F classification over a known bounded usage window was not completed. |

No trigger disable or index removal is authorized. `statsResetAt` was null, and no present-versus-absent write benchmark or recreation rehearsal exists.

## Queue SQL evidence

**MEASURED:** in a 2.474-second idle diagnostic window, `pgboss.job_common` showed two sequential scans and 222,352 tuples read; the table estimate was 111,176 live and 1,886 dead tuples.

**DERIVED:** diagnostics themselves contributed activity, and this idle result cannot quantify ingestion queue cost. It only justifies measuring shared-table/history effects under controlled load.

## WAL/commit status

- **MEASURED:** audited ingestion transactions retained synchronous commit.
- **DERIVED:** commit can wait on WAL durability; whether it limits throughput is **UNKNOWN**.
- **MEASURED:** idle WAL deltas were contaminated by diagnostic/background activity and are not WAL/event evidence.
- **UNKNOWN:** typed, trigger, index, outbox, fairness, and usage WAL attribution.

## Optimization gates

Any query/index/payload optimization must preserve:

1. ACK after COMMIT;
2. typed/outbox atomicity;
3. retry-stable idempotency and inserted-only billing;
4. public-ID/default/trigger behavior;
5. analytics/search/API compatibility;
6. tenant fairness and DLQ behavior; and
7. rollback/migration safety.

Require isolated repeated baseline/candidate runs with statement digests, `EXPLAIN (ANALYZE, BUFFERS, WAL)` only on a safe target, CPU/backends/locks, process memory, and complete correctness checks.

## Related documents

- [Query inventory](query-inventory.md)
- [Index forensics](index-forensics.md)
- [Trigger forensics](trigger-forensics.md)
- [Connection pools](connection-pools.md)
- [Trace ingestion](../ingestion/trace-ingestion.md)
- [Forensic report](../performance/forensic-report.md)
