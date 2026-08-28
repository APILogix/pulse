# 12 — Recovery analysis

# NOT MEASURED

No recovery check has been executed — it only runs automatically after a ramp run detects saturation ([`runRecoveryCheck()`](../../../scripts/bench/load-modes.ts)), and no ramp run has been executed.

## What this measures, once executed (spec §22)

After the ramp controller detects the first unsustainable rate step, it automatically:
1. Reduces offered rate to `--recovery-rate` (default: half the first configured rate step).
2. Polls worker metrics every `--recovery-poll-interval-ms` (default 5s) for up to `--recovery-duration-ms` (default 120s).
3. Records `recoveredWithinMs` — the wall-clock time from recovery start until `ingest_queue_oldest_pending_job_age_ms` drops back to within the configured SLO threshold.
4. Records `finalQueueOldestAgeMs` and whether the check `timedOut` (never recovered within the window).

## What "recovery" does NOT currently verify

Per spec §22, a complete recovery test should also verify:
- No memory leak (worker RSS returns to baseline) — **not measured**; the worker metrics endpoint doesn't currently export RSS (see [`07-worker-capacity.md`](07-worker-capacity.md)).
- No persistent lock buildup — partially measurable via DB samples' `waitingLocks` count if `--db-url` is supplied, but not yet cross-checked automatically against a "returned to baseline" condition in `runRecoveryCheck()`.
- Database returns to normal utilization — partially measurable via DB samples' connection utilization, same caveat as above.
- Workers remain healthy (no crashes/restarts during recovery) — **not measured**; no restart-count sampling is wired into the HTTP-level collector (see [`07-worker-capacity.md`](07-worker-capacity.md) for the PM2-based approach the direct-DB harness already uses, not yet ported here).

These are documented gaps, not silent omissions — treat a "recovered" verdict from this framework as "queue age returned to normal," not as a complete health clearance, until the above gaps are closed.

## Related documents

- [Saturation analysis](11-saturation-analysis.md)
- [Worker capacity](07-worker-capacity.md)
- [Regression benchmark](15-regression-benchmark.md)
