# 15 — Regression benchmark

Status: FAST REGRESSION mode wired and ready to run; FULL CAPACITY modes built but not yet executed anywhere.

## CI / manual modes (spec §29)

| Mode | Command | Duration | Safe for CI/automatic runs? |
| --- | --- | --- | --- |
| FAST REGRESSION | `npm run bench:ingestion:http:fast-regression -- --target-url <url> --api-key <key> --environment benchmark` | ~20s | Yes — `baseline` mode at ~5 events/sec, low enough to run on every deploy to a staging/benchmark environment. |
| FULL CAPACITY | `npx tsx scripts/bench-ingestion-http.ts --mode ramp\|burst\|sustained\|soak ...` (see [`README.md`](README.md) §3) | Minutes to hours | **No** — never wired to run automatically. These modes are unconditionally refused against a production-looking target regardless of flags, and are intended for manual, deliberate execution against a dedicated isolated environment only. |

This satisfies spec §29's requirement: "Support at least two modes... Do not run destructive full-capacity tests automatically against production." No CI configuration in this repository invokes `ramp`/`burst`/`sustained`/`soak` automatically; only the fast-regression baseline command is registered as an npm script suitable for that purpose.

## What makes this a permanent regression suite (spec §28)

The framework stays in the repository (`scripts/bench-ingestion-http.ts`, `scripts/bench/*`, `docs/ingestionv2/benchmark/*`) rather than being a one-off script. Intended usage after any of: worker changes, batching changes, index changes, trigger changes, PostgreSQL changes, Neon upgrades, queue changes, concurrency changes, schema changes:

1. Run FAST REGRESSION against a staging/benchmark environment; compare its JSON output against the last known-good baseline using `npm run bench:ingestion:compare` (see caveat below).
2. For changes specifically targeting capacity (pool sizes, concurrency, index/trigger changes, Neon plan changes), run the FULL CAPACITY `ramp` mode against an isolated environment before and after the change, and compare `lastSustainableRatePerSecond` and the bottleneck attribution.

## Known follow-up work (identified during this build, not yet implemented)

These are honest gaps, listed so they are not silently lost:

| Gap | Where | Why it matters |
| --- | --- | --- |
| Comparator does not understand the HTTP generator's JSON shape | `scripts/compare-ingestion-benchmarks.ts` expects `bench-ingestion-worker.ts` field names (`throughputEventsPerSec`, `totalLatencyMs`, etc.) | Needs a dedicated `compare-ingestion-http-benchmarks.ts` or an adapter, before automated regression comparison works for HTTP-level runs. |
| No automatic repetition for ramp/sustained/soak | `scripts/bench/load-modes.ts` | A single run is a point estimate; spec's general evidence discipline (and this repo's existing `filterValidRepetitions()` pattern in `scripts/lib/aggregate.js`) calls for 3+ repetitions before treating a number as representative. |
| Worker CPU/RSS/GC not exposed by the metrics endpoint | `src/modules/ingestion/workers/metrics-server.ts` | Bottleneck attribution for "is the worker process itself CPU/memory bound" currently has no direct signal; would require either a worker-side metrics addition (production code change, needs separate review) or external PM2-based sampling (already used by `bench-ingestion-worker.ts`, not yet ported to the HTTP collector). |
| No Neon-API-level CU/compute utilization sampling | `scripts/bench/metrics-collector.ts` | Only `pg_stat_activity`/`pg_locks`/WAL-LSN/commit counters are sampled; true compute utilization requires either the Neon API or a `pg_stat_statements`-derived proxy (extension availability unconfirmed on any real target in this session). |
| No worker restart/crash detection in the HTTP-level collector | same | `bench-ingestion-worker.ts` already reads `pm2 jlist` for this; not yet added to the HTTP path's collector. |
| No `--tenants N` single-process convenience flag on the HTTP generator | `scripts/bench-ingestion-http.ts` | Multi-tenant testing currently requires manually running N separate provisioned-fixture processes (documented in [`10-multitenant-results.md`](10-multitenant-results.md)); a single-process N-tenant convenience mode would simplify this but was not built in this session. |
| No variant SQL for index/trigger A/B | `scripts/bench/schema-variants/` | Requires querying an actual isolated target's live catalog first — cannot be authored blind (see [`09-index-trigger-impact.md`](09-index-trigger-impact.md)). |

None of these gaps blocks running the framework today for baseline/fixed-rate/ramp/burst/sustained/soak against a real target — they limit the depth of bottleneck attribution and automated comparison available from the results.

## Related documents

- [Benchmark overview](01-benchmark-overview.md)
- [README (how to run)](README.md)
- [Tooling classification](01-tooling-classification.md)
