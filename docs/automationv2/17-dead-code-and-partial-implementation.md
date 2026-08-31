# 17 — Dead Code and Partial Implementation Audit

## Confirmed dead (no consumer / no producer / no call site)

| Item | Evidence | Classification |
|---|---|---|
| `alert.correlate` pg-boss queue | Produced via `runCorrelationSweep()` (`escalation.worker.ts`); zero `pgboss.work('alert.correlate', ...)` found in full-tree grep | DEAD CODE / UNREACHABLE |
| `notification.digest` pg-boss queue | Produced via `runDigestSweep()`; zero consumer found | DEAD CODE / UNREACHABLE |
| `runCorrelationSweep()` / `runDigestSweep()` functions themselves | No call sites found outside their own definitions in this pass (not exhaustively verified — recommend a full call-site grep before deleting) | LIKELY DEAD, NOT FULLY CONFIRMED |
| `SnapshotEscalationWorker` (V2 escalation) | Per `ALERTING_V2_HARDENING_REPORT.md` §J2 (cited, not re-derived): zero call sites; legacy `escalation.ts` is the only functioning escalation path | DEAD CODE (per prior audit, trusted) |
| `metric-registry.ts` (alerting) | Per `ALERT_RULE_CORRECTNESS_AUDIT.md` (cited): unused dead code backing the decorative `aggregate_function`/`lookback_minutes` fields | DEAD CODE (per prior audit, trusted) |
| Log DB legacy `alert_incidents` table | Per `ENTERPRISE_INCIDENTS_REPORT.md` R2 (cited): dead, blocked from removal by an FK from `alert_correlation_groups` | DEAD, BLOCKED FROM CLEANUP |
| Legacy `connector-send-*` family | Per hardening report (cited): confirmed fully deleted already — not dead code remaining, mentioned here only to confirm it's resolved, not still present | RESOLVED, not a current finding |

## Placeholder / mock (structured, not accidental)

17 automation action types are hardcoded `notImplementedResult()` stubs (full list in `03-automation-rule-inventory.md` and `06-action-engine.md`) — **PLACEHOLDER / MOCK**, by deliberate design (returns success+skipped, never fakes a real side effect). This is a defensible safety choice (never lying about having performed a destructive action) but means the feature set advertised by having these action types in the schema/API is not delivered.

9 further action types (`notification.send`, `quota.notify`, `security.notify`, `approval.request`, `connector.delivery.retry`, `alert.silence.create`, `ai.summary.generate`, `ai.root_cause.generate`, `report.export`) have real handler code but fall through to the same stub path because `automation.module.ts` constructs `ActionRunnerRegistry` without injecting any `AutomationIntegrations` — **IMPLEMENTED BUT UNVERIFIED / effectively unreachable in current wiring**, distinct from the 17 hardcoded stubs but with an identical practical outcome today.

Per prior audit (`ALERT_RULE_CORRECTNESS_AUDIT.md`, cited): `AlertRouteWizardPage` frontend uses hardcoded mock connectors (routes save nonexistent connector IDs) — a frontend-side placeholder bug, out of this backend-focused audit's direct verification scope but worth carrying forward since it's a functional bug, not stale.

## Grep results for literal markers

`grep -iE "TODO|FIXME|not implemented|not_implemented"` across `src/modules/automation/**` and `src/modules/alerting/**`: **zero matches in either directory**. This codebase does not leave loose TODO/FIXME comments — unimplemented behavior is expressed as structured code (the `notImplementedActions` array, `notImplementedResult()` helper), which is good practice for code hygiene but means a naive TODO-grep-based audit would have completely missed the 17-action-type gap. This is exactly the kind of gap the audit brief warns about (§25: "A database row saying an automation exists does not prove execution").

## Routes/tables/workers/queues with no consumer (cross-reference)

- `alert.correlate`, `notification.digest` — covered above.
- All automation queues (`automation-inbox`, `automation-run-execute`, `automation-maintenance`, `automation-dead-letter`, `automation-schedule`) have matched producer/consumer pairs — **not dead**, confirmed in doc 07.
- Automation runtime tables (`automation_runs`, `automation_run_steps`, `automation_events_inbox`, `automation_audit_logs`) are written by code that would currently fail against the live schema (doc 08) — these aren't "dead" in the sense of unused, they're **actively depended upon by code that cannot successfully write to them today** given the confirmed live schema gap.

## Rules that can be created but never meaningfully executed

Any automation workflow using one of the 26 currently-non-functional action types (see above) can be fully created, published, enabled, triggered, and will complete with `status: 'succeeded'` while performing zero real-world effect. This is not a crash or an error — it is a **silently successful no-op**, which is arguably worse for a user's trust in the system than an outright failure, since nothing in the run's status signals that the configured action didn't happen.
