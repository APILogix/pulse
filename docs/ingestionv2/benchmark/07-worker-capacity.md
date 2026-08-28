# 07 — Worker capacity

Status: static configuration facts confirmed from source; **measured worker CPU/memory/GC behavior under load is NOT MEASURED**.

## Configured concurrency (facts, cited to source)

| Setting | Default | Source |
| --- | ---: | --- |
| Typed worker local concurrency (per queue, per process) | 2 | `env.ts:341` (`INGESTION_TYPE_WORKER_CONCURRENCY`) |
| Typed worker batch size (jobs delivered per callback) | 4 | `env.ts:342` (`INGESTION_TYPE_WORKER_BATCH_SIZE`) |
| Number of typed queues | 10 | `queue/ingest-queues.ts:29-40` |
| Max typed jobs fetched/active per process | 10 × 2 × 4 = 80 | derived from the above |
| DLQ intake concurrency/batch | 2 / 10 | prior audit finding, unchanged in this session |
| Max DLQ jobs delivered per process | 20 | derived |
| DB write-admission permits (bounds concurrent transactions, not fetched jobs) | 16 | `env.ts:283` |

**This is a fetch/delivery ceiling, not a throughput measurement.** Up to 80 typed jobs can be held by one worker process simultaneously, but only 16 of them can be inside an active DB transaction at once (the rest wait on the write-admission FIFO gate). Whether the process can actually sustain enough throughput to keep 80 jobs flowing, and what CPU/memory that costs, is unmeasured.

## What the benchmark will measure once executed

Via `--worker-metrics-url`, [`metrics-collector.ts`](../../../scripts/bench/metrics-collector.ts) samples:
- `ingest_write_admission_permits` / `_in_flight` / `_queued` — live admission saturation.
- `ingest_db_pool_connections{pool,state}` — total/idle/waiting per pool.
- `ingest_queue_depth_*`, `ingest_dlq_retained_jobs`, `ingest_queue_oldest_pending_job_age_ms`.
- `ingest_events_inserted_by_type_total` (delta across the run = durable completion rate).

It does **not** currently sample worker process CPU%, RSS, or GC pause time directly — the worker Prometheus endpoint (`metrics-server.ts`) does not export these (confirmed absent from its documented metric families in the prior audit and in this session's re-check of `metrics-server.ts:1-40`). Options for closing this gap, not yet implemented:
1. Add `process.cpuUsage()`/`process.memoryUsage()` gauges to the worker's own metrics endpoint (a production code change, out of scope for this benchmark-only task without separate review/approval).
2. Sample OS-level process stats externally (e.g. `pm2 jlist`, matching the pattern already used by the direct-DB harness's `pm2AppName` option) — the HTTP-level collector does not do this yet; listed as follow-up in [`15-regression-benchmark.md`](15-regression-benchmark.md).

## Worker restarts / crashes

Not currently observed by this collector. The existing direct-DB harness (`bench-ingestion-worker.ts`) reads PM2 restart counts via `pm2 jlist` for its own runs; the same technique could be added to the HTTP-level collector's stop() output. Not implemented in this session.

## Related documents

- [Current capacity](04-current-capacity.md)
- [Queue capacity](08-queue-capacity.md)
- [Bottleneck analysis](05-bottleneck-analysis.md)
