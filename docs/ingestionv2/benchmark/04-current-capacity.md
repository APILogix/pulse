# 04 — Current capacity

# NOT MEASURED

No benchmark run has been executed against any target. Every field below that would normally contain a number is `NOT MEASURED`.

## Required outputs (spec §13) — all NOT MEASURED

| Metric | Value |
| --- | --- |
| Sustainable events/sec | NOT MEASURED |
| Sustainable events/min | NOT MEASURED |
| Peak stable events/sec | NOT MEASURED |
| p50 latency | NOT MEASURED |
| p95 latency | NOT MEASURED |
| p99 latency | NOT MEASURED |
| Saturation point | NOT MEASURED |
| Dominant bottleneck | NOT MEASURED |
| Resource utilization at saturation | NOT MEASURED |

## What is known without a benchmark (facts, not capacity numbers)

These are architectural facts from the source audit ([`00-discovered-architecture.md`](00-discovered-architecture.md)). They describe **configured ceilings**, not measured throughput, and must not be multiplied together to produce a capacity claim (spec §9 explicitly forbids this).

| Fact | Value | Source |
| --- | ---: | --- |
| HTTP batch cap | 1000 events/request | `env.ts:216` |
| pg-boss job chunk size | 200 events/job | `env.ts:309` |
| Job max bytes | 1 MiB/job | `env.ts:313` |
| Per-event byte cap | 256 KiB | `service.ts:73` |
| Typed worker concurrency (per process, per queue) | 2 | `env.ts:341` |
| Typed worker batch size (jobs/callback) | 4 | `env.ts:342` |
| DB write-admission permits | 16 (default) | `env.ts:283` |
| Dedicated write pool size | 20 | `env.ts:279` |
| Backpressure high/critical water | 100,000 / 250,000 pending jobs | `env.ts:219-220` |

None of these numbers is a throughput figure. A system can be far below or (in principle) above a naive multiplication of these ceilings depending on where the true bottleneck sits — which is exactly what this benchmark exists to find and has not yet found.

## How to populate this report

Run at minimum a `fixed-rate` benchmark and a `ramp` benchmark against a real target (see [`README.md`](README.md) §3), then:

1. Take the sustained rate from the highest `ramp` step whose `verdict.sustainable === true`.
2. Take p50/p95/p99 from that step's `result.outcomes` latency distribution (or from the JSON's computed `latencyQuantiles` for fixed-rate/baseline runs).
3. Take the saturation point from `modeResult.saturationRatePerSecond` in the ramp report.
4. Take the dominant bottleneck from [`05-bottleneck-analysis.md`](05-bottleneck-analysis.md), populated using the same run's `workerSamples`/`dbSamples`.

## Related documents

- [Bottleneck analysis](05-bottleneck-analysis.md)
- [Saturation analysis](11-saturation-analysis.md)
- [Recommended safe capacity](14-recommended-safe-capacity.md)
