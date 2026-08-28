# 13 — Neon upgrade comparison

# NOT MEASURED

No second Neon environment was available in this session, and no comparison benchmark has been executed. Per the master prompt's non-negotiable rule: **"Never claim 'upgrading Neon will give us X% more throughput' unless the upgraded environment has actually been benchmarked."** No such claim is made here.

## What this requires, once both environments exist (spec §14)

Keep constant across both runs:
- application version (same git commit)
- schema, indexes, triggers (same migration state)
- worker replica count and configuration
- batch size and event mix (same `--profile`, `--batch-size`)
- test duration and benchmark generator (same commands, same `scripts/bench-ingestion-http.ts`)
- target region, where possible

Change only the database capacity variable (Neon compute size / plan).

## Comparison procedure, once both runs exist

1. Run the identical `ramp` command against the current-plan target. Save `artifacts/bench-http-ramp-current-plan.json`.
2. Provision the upgraded-plan Neon branch/project with the same schema (a branch, not a fresh empty database, so index/trigger/data-volume state matches).
3. Run the identical `ramp` command against the upgraded-plan target. Save `artifacts/bench-http-ramp-upgraded-plan.json`.
4. Compare, field by field:

| Field | Current plan | Upgraded plan | Delta |
| --- | ---: | ---: | ---: |
| `lastSustainableRatePerSecond` | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| `saturationRatePerSecond` | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| p95 latency at last sustainable rate | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| DB CPU/connection utilization at saturation | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| WAL bytes/event at saturation | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| Dominant bottleneck | NOT MEASURED | NOT MEASURED | NOT MEASURED |

5. Only after this table is populated with real numbers can a statement like "upgrading from plan A to plan B increased sustainable throughput by N%" be made — and only if the dominant bottleneck at saturation was actually database-side (CPU/connections/WAL/IO) on the current plan. If the current-plan bottleneck turns out to be worker concurrency, write-admission permits, or application-level fairness (see [`05-bottleneck-analysis.md`](05-bottleneck-analysis.md)), a Neon upgrade would show **no material improvement** regardless of plan size, and that would itself be a valid, useful finding.

## Related documents

- [Database capacity](06-database-capacity.md)
- [Bottleneck analysis](05-bottleneck-analysis.md)
- [Recommended safe capacity](14-recommended-safe-capacity.md)
