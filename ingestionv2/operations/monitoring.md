# Ingestion monitoring

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

No latency, throughput, queue-age, pool-wait, RSS, WAL, or trigger threshold has been calibrated. Set alert thresholds only from production SLOs plus representative observations.

## Worker-exported signals

| Metric family | Use |
| --- | --- |
| `ingest_jobs_{processed,failed,retried}_total{queue}` | Worker outcome/retry trends. |
| `ingest_events_{received,inserted,rejected,failed}_total{queue}` | Volume and disposition. |
| `ingest_events_failed_by_reason_total{queue,type,reason}` | Stable failure classification. |
| `ingest_*_by_type_total{queue,type}` and `ingest_batch_bytes_total` | Per-type durable inserts/input volume. |
| `ingest_events_duplicate_total{queue,type}` | Typed conflict suppression trend. |
| `ingest_processing_latency_ms_*`, `ingest_e2e_latency_ms_*` | Rolling in-process and enqueue-to-finish distributions. |
| `ingest_stage_latency_ms_*{stage,type}` | Admission/checkout/normalization/write-stage separation; inspect emitted labels. |
| `ingest_db_query_duration_ms_*`, `ingest_db_queries_per_batch_*` | Query duration/count by observed batch. |
| `ingest_write_admission_{permits,in_flight,queued,queued_peak}` | Transaction admission saturation. |
| `ingest_db_pool_connections{pool,state}` | Pool total/idle/in-use/waiting. |
| `ingest_queue_depth_*`, `ingest_queue_oldest_pending_job_age_ms*` | Aggregate and per-queue backlog/age. |
| fairness defer/process/starvation-guard and org in-flight | Process-local fairness only. |
| `ingest_error_group_merge_fallback*_total` | Retained O(N) error grouping path. |
| rollup run/failure/last-run families | Usage rollup progress. |

The rolling quantiles are process-local bounded samples, not fleet-wide histograms. Scrape/aggregate semantics must be documented before SLO use.

## Required external/platform signals

The worker endpoint does not close all observability gaps. Collect:

- process/container RSS, heap used/limit, GC pauses, event-loop delay, CPU, restart/OOM reason;
- Log/Primary DB active/idle/waiting sessions and server connection ceiling;
- lock waits/deadlocks, commits/rollbacks, statement/lock timeout rates;
- WAL bytes/records, checkpoint behavior, table/TOAST/index growth, dead tuples/autovacuum;
- pg-boss queue age/state and retained rows by queue; and
- PostgreSQL restart/failover events plus usage staging/rollup state.

Static fleet ceilings recorded in the audit (Primary 97, Log primary 84, Log replica 60) are configuration arithmetic, not measured peak demand. Recorded server slots were 895 conditionally; confirm endpoint/role before capacity decisions.

## Diagnostic interpretation

1. Rising queue age with admission queue growth: transaction demand exceeds the current process-local admission rate; determine whether DB has headroom before tuning.
2. Low admission wait but pool `waiting`/checkout latency: pool or shared DB connection pressure.
3. Low pool wait but high query duration/lock errors: SQL/lock/storage issue, not a reason to increase permits.
4. Retries plus abort/timeout classes: inspect callback-batch expiry, active cancellation, COMMIT outcome, and rollback/release.
5. Fairness counters: detect local deferral/starvation guard only; fleet-wide tenant fairness remains unknown.
6. Usage flush/rollup health: cannot detect counts lost before staging solely from staging metrics.

## Memory gate

Default typed delivery permits up to 80 fetched/active jobs while only 16 transactions are admitted. About 80 MiB of raw typed payload can exist before copies/metadata; total RSS is unmeasured and trace-derived full-parent payload replication is O(S²). Monitor externally and keep the strict memory acceptance gate **UNMET** until representative load evidence exists.

## Evidence/alert gaps

- no hard queue/API/tenant capacity;
- no fleet-wide fairness metric;
- no direct durable “usage expected versus staged” reconciliation;
- no calibrated SLO or threshold;
- no representative load/chaos/failover run; and
- no measured before/after performance data.

## Acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Worker metric inventory | PASS | `metrics-server.ts` source review |
| DB/queue diagnostic dimensions | PASS (documented) | read-only audit/tool inventory |
| CPU/RSS/heap/GC baseline | **UNMET** | no load run |
| Fleet fairness visibility | **UNMET** | fairness is process-local |
| Billing reconciliation visibility | **UNMET** | pre-staging loss has no source |
| SLO/alert calibration | **UNMET** | no representative baseline |
