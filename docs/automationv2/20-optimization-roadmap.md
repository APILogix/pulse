# 20 — Optimization Roadmap

## P0 — correctness/security/durability (do first, blocks everything else)

1. Write and apply the missing automation runtime migration (root-cause #1) — add `next_retry_at`, `locked_at`, `locked_by`, `attempts`, `received_at`, `processed_at`, `last_error`, `sort_order`, `timeout_at`, `idempotency_key`, `approval_id` to `automation_runs`, `automation_run_steps`, `automation_events_inbox` (and confirm which of these `automation_audit_logs` actually needs — it may need fewer, since it's write-mostly).
2. Add an integration test that builds a real schema from the actual migration files and exercises `claimInboxEvents`/`createRunWithSteps`/`claimNextStep` against it (root-cause #2) — this is what would have caught #1 before it reached this audit.
3. Change the run/step status for `notImplementedResult()` outputs from indistinguishable-success to a visibly distinct state (root-cause #3) — smallest possible change with the biggest trust impact; can ship independently of implementing any real action.
4. Confirm/ship the fingerprint migration for in-flight alerts (root-cause #12) — already flagged as deploy-blocking by the prior hardening report; this audit just re-confirms it's still open.

## P1 — reliability/performance

5. Wire real integrations for the 9 conditionally-implemented action types, forwarding the idempotency key end-to-end (root-cause #4, #5).
6. Resolve the double-retry-path risk for failed automation steps (root-cause #6) — requires a live trace or targeted test first to confirm actual behavior before choosing which path to remove.
7. Add per-organization concurrency/rate limiting for automation inbox processing and alerting evaluation dispatch (root-cause #8).
8. Either enforce or remove `max_notifications_per_hour`/`throttle_duration_seconds` (root-cause #9).
9. Address lookback/aggregation decorative fields and absence/inactivity rule gaps in alerting (root-cause #13) — largest remaining correctness gap per the hardening report's own words; this audit defers to that report's existing plan rather than re-designing it.

## P2 — architecture/maintainability

10. Remove or implement `alert.correlate`/`notification.digest` (root-cause #7).
11. Decide the fate of `SnapshotEscalationWorker` and `metric-registry.ts` — delete if truly dead, per hardening report §J2 and correctness audit findings.
12. Consider RLS as defense-in-depth for the highest-risk tenant-scoped tables (root-cause #11) — architectural decision requiring broader buy-in, not a quick patch.
13. Decide whether automation should have an explicit bridge from alerting/other modules' events (root-cause #10), or formally scope automation as "external-event-driven only" if that's the actual product intent.

## P3 — polish

14. Reconcile naming discrepancies between prior audit docs and current code (e.g. `claimBreachDecision` vs the actual `claimRecovery` function name) so future audits don't need to re-derive this mapping.
15. Consolidate automation's and alerting's separate SSRF guard implementations (`src/modules/automation/ssrf.ts` vs `src/shared/utils/ssrf.ts`) into one shared, consistently-enforced implementation, or explicitly document why they differ.
16. Add W3C traceparent propagation across pg-boss job queues (carried forward from the original production audit's P3 finding — still not addressed in any later doc reviewed).
