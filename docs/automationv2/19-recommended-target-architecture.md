# 19 — Recommended Target Architecture

Per audit rule #30 (fixes section): do not rewrite the architecture unnecessarily, do not introduce new infrastructure without evidence. The orchestration architecture found (pg-boss, transactional claim queues, advisory locks, atomic gates) is sound and should be preserved. The recommendations below are about closing gaps in the existing architecture, not replacing it.

## Automation — target state

```
Same topology as today (02-current-architecture.md), with:
1. Runtime schema brought into alignment with code (fix #1 in root-cause matrix) — this is the prerequisite for everything else.
2. Integration test added that runs against the real migration-built schema (fix #2), to prevent this class of drift recurring silently.
3. Action layer: either (a) real integrations wired for the 9 "conditionally real" handlers, with idempotency keys forwarded end-to-end, or (b) explicit product decision to descope specific action types, with their status changed from "succeeded" to a visibly distinct "not_implemented"/"unsupported" run status so users aren't misled.
4. Per-organization concurrency/rate cap added at the inbox-claim level (e.g. `claimInboxEvents` biased or capped per org within a batch) to prevent one tenant from monopolizing the shared worker pool.
5. Automation-to-alerting bridge: if product intent is "alerts trigger automations," add an explicit, documented caller (alerting's decision engine or notification router posts to automation's `/events` API on relevant state transitions) rather than leaving this as an implicit expectation with no code behind it.
```

## Alerting — target state

Per the already-existing hardening report's own "still open" list (§J), this audit does not propose a different architecture — it endorses continuing that report's own roadmap:
```
1. Ship the fingerprint migration for in-flight alerts before any deploy of the fingerprint change (J1/R7) — deploy-blocking, already identified.
2. Either give SnapshotEscalationWorker real call sites or delete it (J2) — dead code should not persist indefinitely.
3. Make lookback/aggregation condition fields real, or remove them from the API surface if they will remain decorative (J4).
4. Design and implement a genuine "confirmed absence" evaluation path for inactivity/absence rules (J5) — this requires evaluating on a schedule even when no rollup row exists, not just reacting to incoming rollups.
5. Wire max_notifications_per_hour/throttle_duration_seconds enforcement into the decision/dispatch path, or remove the fields (new finding, item 9 in root-cause matrix).
6. Remove or wire up alert.correlate/notification.digest (item 7).
```

## What this audit explicitly does NOT recommend

- No Redis/Kafka/message-broker replacement for pg-boss — no evidence found that pg-boss is the bottleneck; the actual problems found are schema drift, unimplemented handlers, and missing rate limits, none of which a different queue technology would fix.
- No RLS rollout prescribed as an immediate fix — flagged as a defense-in-depth consideration (item 11), consistent with prior docs treating it as an accepted, not urgent, risk.
- No blind index additions — see doc 16.
- No removal of the double-retry mechanism (item 6) without first confirming via a live trace which of the two retry paths is actually firing — removing the wrong one could reduce retry reliability instead of fixing a duplication risk.
