# 13 — Rate Limiting and Backpressure

## Per-tenant limits

- Automation: `maxRunsPerHour` (default 100, overridable per workflow via `safety.maxRunsPerHour` in the workflow version definition) — this IS a real per-workflow, per-org rate limit, enforced atomically (see doc 09). This is the **only** per-tenant rate limit found in either subsystem.
- Automation: `cooldown_seconds` per trigger — also real, enforced in the same atomic gate.
- Automation: `checkWorkflowLimits()` at creation time (`repo.countOrgWorkflows` vs `repo.getWorkflowLimit`, tied to `quota.alert_rules` feature) — this limits the *number of workflows*, not execution volume.
- Alerting: `alert_rule_actions.max_notifications_per_hour` and `throttle_duration_seconds` columns **exist in the schema** (`rules.repository.ts` `RuleActionInsert` interface, INSERT statement) but **no read-side enforcement was found** in `decision.engine.ts` or `escalation.worker.ts` — grepped both files for the field name with no usage found beyond the INSERT. Classification: **PARTIALLY IMPLEMENTED / likely DEAD** — the field is captured and persisted but not confirmed to be enforced anywhere. This is a new finding not previously documented in the prior six docs reviewed.

## Global / infrastructure-level limits

- `localConcurrency`/`batchSize` on pg-boss worker registrations (`connectors/queue.ts`, `automation/workers.ts`) — these bound how many jobs a single worker process handles concurrently per queue, but this is a flat global cap shared across all tenants using that queue. **NOT tenant-aware.**
- No `rateLimit`/`throttle`/`maxConcurrency` pattern was found anywhere in `src/modules/alerting/**` beyond the worker-registration concurrency options (grepped explicitly, zero matches for those terms as rate-limiting logic).

## What happens if one customer generates 100,000 matching events?

Based on code alone (no load test was run — **NOT VERIFIED LIVE**):
- Automation: the `maxRunsPerHour` cap (100/hour default) would cap actual *run creation* regardless of event volume — but the events themselves would still all be inserted into `automation_events_inbox` (subject to the dedupe key) and claimed/processed by `processInbox`, each one hitting the cooldown/rate-limit check (which is cheap — two indexed `SELECT`s inside an advisory-locked transaction) before being rejected. So execution is bounded, but inbox table growth and per-event evaluation overhead are not bounded by this same limit — a burst of 100,000 events for one workflow would still cost ~100,000 evaluation-gate-check cycles even though only ~100 runs get created. This is a real, if modest, backpressure gap: **the noisy tenant's inbox processing work scales with event volume, not with the rate limit.**
- Alerting: no per-tenant cap on evaluation frequency was found; the tiered evaluation architecture (fast/window/operational/AI) processes per active-org batches, so one very noisy org's fast-tier evaluation runs every ~1s regardless of how many other tenants exist — this is bounded by the global worker concurrency, meaning a big enough noisy tenant could, in principle, starve the fast tier's ability to serve other tenants promptly if a single worker process handles all orgs' fast-tier jobs. **NOT VERIFIED LIVE** whether this manifests in practice; flagged as a plausible risk based on the absence of any per-tenant slicing found in code.

## Conclusion

**No genuine per-tenant backpressure/rate-limiting exists for ingestion-side volume in either subsystem.** The one real rate limit found (automation's `maxRunsPerHour`) protects against runaway *action execution*, not against a noisy tenant consuming shared inbox/queue processing capacity. This is a legitimate P1/P2 finding, not previously flagged in the six prior docs reviewed (they focus on alerting's decision/delivery correctness, not backpressure).
