# 14 — Recommended safe capacity

# NOT MEASURED — no recommendation can be made yet

No saturation point has been measured (see [`11-saturation-analysis.md`](11-saturation-analysis.md)), so no safety margin can be applied to it. Per spec §27, the saturation rate itself must never be reported as the recommended production ceiling — but neither value exists yet.

## Method to be used once a saturation point exists

```text
measured saturation rate:            X events/sec   (from lastSustainableRatePerSecond
                                                       in the ramp report, NOT
                                                       saturationRatePerSecond — that
                                                       field is the FIRST UNSUSTAINABLE
                                                       rate, one step past the ceiling)
chosen safety margin:                M%              (to be decided with the operator;
                                                       a common starting point is 30-50%
                                                       headroom below the last sustainable
                                                       rate, but this is a policy choice,
                                                       not a measured fact)
recommended operating ceiling:       Y = X × (1 - M/100)
```

## Why a margin is required (rationale, not yet applied to real numbers)

- Repeated measurements typically show variance; a single ramp run's "last sustainable rate" is a point estimate, not a guaranteed floor.
- Production traffic mix will differ from any single benchmark profile; `worst-case`/`multi-tenant` profiles run at the same nominal rate can behave differently from `mixed`.
- Neon and other shared infrastructure can have noisy-neighbor effects not present during an isolated benchmark run.
- The sustainability criteria used here (`DEFAULT_SLO`) are benchmark defaults, not a negotiated production SLA; the actual acceptable error/latency budget in production may be tighter or looser.

## What must exist before this report can be completed

1. At least one completed `ramp` run producing a real `lastSustainableRatePerSecond` (see [`11-saturation-analysis.md`](11-saturation-analysis.md)).
2. Ideally 3+ repeated ramp runs to establish variance, not implemented as an automatic repeat loop in this framework yet (see [`15-regression-benchmark.md`](15-regression-benchmark.md)).
3. An explicit, operator-approved safety margin policy (this benchmark does not set one on its own authority).
4. Confirmation that the dominant bottleneck at saturation (from [`05-bottleneck-analysis.md`](05-bottleneck-analysis.md)) is understood, so the recommended ceiling can be paired with the correct remediation if it needs to be raised later (e.g. "raise write-admission permits" vs. "upgrade Neon plan" are different actions for different bottlenecks).

## Related documents

- [Saturation analysis](11-saturation-analysis.md)
- [Bottleneck analysis](05-bottleneck-analysis.md)
- [Current capacity](04-current-capacity.md)
