# 03 — Workload profiles

Status: all 9 required profiles implemented in [`workload-profiles.ts`](../../../scripts/bench/workload-profiles.ts); **no profile has been run against a target**.

Every payload shape is built to pass the real `event-normalizer.ts` Zod schemas (cited by field name below), so a benchmark run measures acceptance/processing cost, not the reject/DLQ path.

| Profile | Type mix (weighted) | Duplicate ratio | Payload size | Notes |
| --- | --- | ---: | --- | --- |
| `request-heavy` | request 90 / error 5 / log 5 | 0% | normal | Realistic status/latency mix via the `request` schema's `statusCode`/`latency` fields. |
| `log-heavy` | log 90 / message 5 / request 5 | 0% | normal | Realistic log record sizes via `message` (bounded to `LIMITS.maxMessageLen = 4096`). |
| `error-heavy` | error 85 / request 10 / log 5 | 15% | normal | Duplicate ratio simulates recurring crash-loop fingerprints, exercising `error_groups` upsert/regression logic. |
| `trace-heavy` | trace 70 / span 20 / request 10 | 0% | normal, 12 spans/trace | Exercises trace tree flattening and the O(S²) full-parent-payload replication documented in the prior audit. |
| `mixed` | request 30 / log 25 / error 10 / trace 10 / span 10 / metric 8 / message 5 / cron_checkin 2 | 2% | normal, 6 spans/trace | Default profile; realistic combination across all 8 represented event families (profile/replay omitted from the default weight table but supported by the type builder). |
| `duplicate-heavy` | log 50 / request 30 / error 20 | 70% | normal | **Gated**: refused for `log` events unless the target's `events_logs` unique guard is confirmed present (see [`09-index-trigger-impact.md`](09-index-trigger-impact.md) and the prior audit's log-idempotency finding). |
| `large-payload` | error 40 / request 30 / log 30 | 0% | large (~3.8 KB message field, staying under the 256 KiB/event cap) | Tests near-cap payloads without triggering the oversized-event reject path. |
| `multi-tenant` | request 40 / log 30 / error 20 / trace 10 | 0% | normal, 4 spans/trace | Same mix as `mixed`; intended to be run as N concurrent processes, one per separately-provisioned tenant fixture — see recipe below. |
| `worst-case` | trace 30 / error 25 / span 20 / request 15 / log 10 | 20% | large, 20 spans/trace | Combines every expensive legitimate dimension: large payloads, deep traces, error grouping, duplicates, and (when multi-process) multiple tenants. Every component individually validates; nothing is malformed input. |

## Batch-size sweep

Applies orthogonally to any profile via `--batch-size`. Discovered levels (see [`02-test-methodology.md`](02-test-methodology.md)): 1, 10 (small), 100 (medium), 200 (normal/job-chunk), 1000 (maximum/HTTP cap).

## Multi-tenant recipe (not yet executed)

```powershell
npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag tenant-low
npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag tenant-med
npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag tenant-high

# In three concurrent terminals/processes, using each fixture's own fullApiKey:
npx tsx scripts/bench-ingestion-http.ts --mode sustained --rate 5   --profile multi-tenant --api-key $KEY_LOW  --target-url $URL --environment benchmark
npx tsx scripts/bench-ingestion-http.ts --mode sustained --rate 50  --profile multi-tenant --api-key $KEY_MED  --target-url $URL --environment benchmark
npx tsx scripts/bench-ingestion-http.ts --mode sustained --rate 500 --profile multi-tenant --api-key $KEY_HIGH --target-url $URL --environment benchmark
```

Because each fixture resolves to a genuinely distinct `organizationId`, running these concurrently exercises the real `WorkerRegistry` per-process `TENANT_INFLIGHT_LIMIT` fairness gate (`queue/ingest-queues.ts:99-106`), not a simulated allocation. See [`10-multitenant-results.md`](10-multitenant-results.md) for what to look for once this is actually run.

## Duplicate-heavy safety gate detail

[`duplicate-safety-gate.ts`](../../../scripts/bench/duplicate-safety-gate.ts) queries `pg_indexes` for `idx_events_logs_event_unique` on the target's Log DB (pass `--log-db-url`) before permitting a `log`-touching profile with nonzero duplicate ratio to run. If the index is absent, unverifiable, or no `--log-db-url` was provided, the run is refused with an explicit error — never silently degraded to "run anyway." This directly implements spec §21's requirement to stop and document the blocker rather than corrupt benchmark data.

## Related documents

- [Test methodology](02-test-methodology.md)
- [Duplicate/idempotency safety gate source](../../../scripts/bench/duplicate-safety-gate.ts)
- [Multi-tenant results](10-multitenant-results.md)
