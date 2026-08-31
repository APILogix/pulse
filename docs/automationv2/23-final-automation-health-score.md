# 23 — Final Automation Health Score

Scores are for the automation module unless marked "(alerting)". Not inflated; reflects live-verified findings where available, code-read findings otherwise.

| Area | Score | Basis |
|---|---:|---|
| Rule correctness | 55/100 | Evaluator logic is correct; orchestration logic is correct; but cannot currently execute against the live schema, and most actions are stubs |
| Trigger reliability | 30/100 | Event ingestion into the inbox works; the claim step that would process it is broken against the live schema |
| Scheduler reliability | 60/100 | Cron sweep logic (`runScheduleSweep`) is well-designed (durable `next_run_at`, invalid-cron self-disable) but depends on the same broken inbox insert/claim pipeline downstream |
| Queue architecture | 80/100 | Every queue has a matched producer/consumer; pg-boss usage is sound; loses points only for the schema issue being outside the queue layer itself, not for the queue design |
| Worker reliability | 40/100 | Worker code (claim, execute, retry, timeout-reclaim) is well-designed but cannot run against the live schema |
| Condition engine | 85/100 | Pure, safe, ReDoS-mitigated, well-tested as an isolated function |
| Action execution | 15/100 | 17/26 action types are hardcoded no-ops; 9 more unreachable; only 2 genuinely functional (`noop`, `rollback.recommend`) |
| Retry handling | 55/100 | Sound backoff/cap design, but a real double-retry-path risk identified and unresolved |
| Idempotency | 50/100 | Strong at the DB-row level; not enforced end-to-end for external side effects |
| Tenant isolation | 75/100 | Consistently applied app-layer filters; no RLS backstop (shared, accepted risk with alerting) |
| Security | 70/100 | Approval gating and risk classification are solid; SSRF guard exists but is a second, unconsolidated implementation vs. alerting's |
| Observability | 55/100 | Good audit-log data model; no redaction control for arbitrary JSON payloads; no dedicated metrics found |
| Performance | 50/100 | Plausible per-event query fan-out risk under load; not benchmarked |
| Recovery | 55/100 | Sound restart/timeout-reclaim logic on paper; not verified live; blocked by the same schema issue for any live test |
| Test coverage | 35/100 | 8 test files exist but, per direct execution and reading in this audit, test pure functions only — none exercise the real claim/lock SQL that has the P0 bug |

**Automation overall (average): ~54/100 — NOT PRODUCTION READY**, driven primarily by the schema mismatch and the action-execution gap, not by poor engineering of the parts that do work.

## Alerting (for comparison, largely inherited from already-completed hardening work, re-verified spot checks in this audit)

| Area | Score | Basis |
|---|---:|---|
| Rule correctness | 65/100 | Comparison operators correct; lookback/aggregation/absence rules still decorative/broken per hardening report §J4/J5 |
| Trigger reliability | 85/100 | 4-tier evaluation confirmed sound |
| Scheduler reliability | 85/100 | pg-boss cron + adaptive interval dispatch, singletonKey-protected |
| Queue architecture | 80/100 | Sound, minus two confirmed-dead queues |
| Worker reliability | 85/100 | Locking/claim mechanisms directly re-verified in this audit |
| Condition engine | 65/100 | Same caveat as rule correctness |
| Action execution | 80/100 | Connector delivery real, SSRF-protected, encrypted secrets; unverified against real external providers |
| Retry handling | 80/100 | Bounded, `max_retries` default 3 |
| Idempotency | 85/100 | Cooldown race fixed, unified fingerprint (pending the in-flight migration, item 12) |
| Tenant isolation | 75/100 | Same accepted no-RLS risk as automation |
| Security | 85/100 | SSRF re-verified live in this pass, secrets encryption confirmed |
| Observability | 75/100 | Append-only audit trail, rebuildable state |
| Performance | 65/100 | No load test performed by any audit reviewed |
| Recovery | 70/100 | Sound design, not live-fault-tested per hardening report's own admission (§J9) |
| Test coverage | 60/100 | Dedicated concurrency/idempotency test files exist by name; not opened line-by-line to confirm real-DB execution in this pass |

**Alerting overall (average): ~75/100 — PRODUCTION READY WITH CONDITIONS**, consistent with the hardening report's own framing (fixed the worst issues, several correctness/completeness gaps remain open by the hardening report's own admission).
