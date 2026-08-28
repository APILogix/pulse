# 08 — Queue capacity

Status: static configuration and backpressure policy confirmed from source; **measured queue drain rate under load is NOT MEASURED**.

## Backpressure policy (facts)

| Setting | Value | Source |
| --- | ---: | --- |
| High-water pending-job threshold | 100,000 | `env.ts:219` (`INGESTION_BACKPRESSURE_HIGH_WATER`) |
| Critical-water pending-job threshold | 250,000 | `env.ts:220` (`INGESTION_BACKPRESSURE_CRITICAL_WATER`) |
| Queue-depth cache staleness | 3,000ms | `env.ts:348` (`INGESTION_QUEUE_DEPTH_CACHE_MS`) |

Shedding is **advisory and plan-aware**, not a hard cap: at critical water, only top-urgency (`error`/`message`/`cron_checkin`) events from business/enterprise-tier API keys survive (`service.ts:415-430`, `shouldShed()`). There is no hard ceiling that rejects all traffic at any depth — a sufficiently high-priority organization can continue enqueuing indefinitely as far as this policy is concerned. Whether the underlying pg-boss table/Postgres itself degrades before any tier is fully shed is unmeasured.

## Job retry/expiry policy (facts)

| Setting | Value | Source |
| --- | ---: | --- |
| Retry limit | 3 | `env.ts:315` |
| Retry delay (base) | 5s | `env.ts:316` |
| Job expiry | 300s | `env.ts:314` |

## What the benchmark will measure once executed

- Enqueue rate: derived from `offeredEvents`/`acceptedEvents` in the HTTP generator's own outcomes — this IS measured by any run, since it's computed directly from HTTP responses.
- Dequeue/drain rate: derived from `ingest_queue_depth_pending` deltas in worker samples (requires `--worker-metrics-url`).
- Queue wait time: **not directly exposed** by the current worker metrics endpoint as a distinct enqueue-to-pickup latency; `ingest_processing_latency_ms` and `ingest_e2e_latency_ms` histograms exist per the prior audit's metric inventory but were not independently re-verified as queue-wait-only in this session. Confirm the exact metric semantics against `metrics-server.ts` before quoting a "queue wait" number from them.
- Oldest pending job age: `ingest_queue_oldest_pending_job_age_ms` — directly measured once worker metrics are reachable.

## Queue capacity relative to database capacity

The durable pg-boss job table has no documented hard row-count cap in this codebase; its practical ceiling is Postgres storage/performance, which is itself gated by the unknown Neon plan configuration (see [`06-database-capacity.md`](06-database-capacity.md)). A queue-capacity number independent of database capacity cannot be produced.

## Related documents

- [Worker capacity](07-worker-capacity.md)
- [Database capacity](06-database-capacity.md)
- [Saturation analysis](11-saturation-analysis.md)
