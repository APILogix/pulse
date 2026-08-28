# 11 — Saturation analysis

# NOT MEASURED

No ramp-to-saturation run has been executed against any target.

## What this report will contain, once a ramp run completes

Directly from the ramp run's JSON (`modeResult` shape from [`runRampToSaturation()`](../../../scripts/bench/load-modes.ts)):

| Field | Meaning |
| --- | --- |
| `steps[]` | One entry per rate tried, each with its own `result` (offered/accepted/rejected counts, latencies) and `verdict` (which sustainability criteria were met/violated/unmeasured). |
| `saturationRatePerSecond` | The first rate that violated any criterion — `null` if every configured step stayed sustainable. |
| `lastSustainableRatePerSecond` | The highest rate that stayed fully sustainable — this is the practical "found capacity," before any safety margin is applied. |
| `stoppedReason` | Human-readable explanation of why the ramp stopped where it did. |
| `recovery` | The recovery-check result run immediately after saturation was detected (see [`12-recovery-analysis.md`](12-recovery-analysis.md)). |

## Ramp stop conditions implemented (spec §11: stop before destructive saturation)

The ramp controller does **not** run until the database crashes. It evaluates [`sustainability.ts`](../../../scripts/bench/sustainability.ts)'s criteria after every step and stops at the **first** violation:
- error rate > 1% (default)
- p95 latency > 2000ms (default)
- p99 latency > 5000ms (default)
- queue oldest-pending age > 60000ms (default)
- queue depth continuously increasing for 6 consecutive samples (default)
- DB connection utilization > 90% (default)

These defaults are benchmark defaults (`DEFAULT_SLO` in `sustainability.ts`), not a production SLA — override them via the `SloConfig` parameter before treating a saturation point as authoritative for production planning.

## Default rate steps

`5, 10, 25, 50, 100, 200` events/sec, 20 seconds per step (both overridable via `--rate-steps` and `--step-duration-seconds`). These are arbitrary starting points chosen to span a wide range on a first run; they are not derived from any known capacity and should be adjusted based on the first run's outcome (e.g. if step 1 already violates, retry with smaller steps below 5/sec).

## Related documents

- [Current capacity](04-current-capacity.md)
- [Recovery analysis](12-recovery-analysis.md)
- [Recommended safe capacity](14-recommended-safe-capacity.md)
