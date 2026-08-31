# 14 — Observability and Monitoring

## What exists

- Automation: `automation_audit_logs` records every lifecycle transition (`run.queued`, `run.started`, `run.failed`, `approval.requested`, `step.started`, `step.completed`, `step.failed`) with `organization_id`, `project_id`, `workflow_id`, `run_id`, `step_id`, `actor_user_id` — these are exactly the correlation identifiers the audit brief asks for. Classification: **VERIFIED WORKING** as a data model, contingent on the schema-mismatch caveat in doc 08 (this table is one of the four affected).
- Automation: `automation_runs`/`automation_run_steps` status columns double as a queryable execution-history/observability surface (success count, failure count, last run time derivable by querying status + timestamps) — no dedicated metrics/dashboard code was found in this module; this is "observability via SQL query," not instrumented metrics (e.g. no Prometheus counters found in `src/modules/automation/**`).
- Alerting: `alert_events_v2` + `alert_event_history_v2` are explicitly documented (per prior audit trust) as making `alert_event_state` "fully rebuildable" — i.e., the audit trail is the source of truth, which is a strong observability/debuggability property.
- Alerting: metrics calls referenced in `decision.engine.ts` (`recordIncidentOpened`, `recordIncidentReused`, `recordIncidentResolved`, `recordIncidentPersistFailed`) — real instrumented counters exist for the incidents path specifically. **NOT independently re-verified** which metrics backend these feed (Prometheus, statsd, etc.) — out of scope of this pass.

## What's missing or NOT VERIFIED

- No dedicated "queue backlog depth" or "stuck execution" alerting was found for either subsystem's own operational health (i.e., nothing found that pages an engineer if `automation-run-execute` backs up, or if pg-boss itself falls behind). pg-boss may expose this via its own tables, but no code consuming that for alerting-on-the-alerting-system was found.
- No per-rule/per-workflow success/failure rate dashboard code was found — this data is queryable from the tables above but not confirmed to be surfaced anywhere (frontend was out of scope for this pass).
- Secrets/PII exclusion from logs was spot-checked (see doc 12) for the alerting notification path specifically — not exhaustively verified for automation's audit log payloads (`input`/`output` JSONB columns on `automation_runs`/`automation_run_steps` could contain arbitrary event/action payload data, and no redaction step was found before these are written). **This is a real gap worth flagging**: if a triggering event or an action's output happens to contain a secret (e.g. an API response body), it would be persisted verbatim into `output jsonb` with no redaction layer found in `workers.ts` or `audit.ts`. Classification: **NOT VERIFIED whether this is a problem in practice** (depends entirely on what real event/action payloads contain, which is currently mostly moot since most actions are stubs) but architecturally there is no redaction control today.

## Correlation identifiers

Both subsystems consistently thread `organizationId`, `projectId` (where applicable), `workflowId`/`ruleId`, `runId`/`alertKey`, `stepId`/`eventId` through their audit/history tables — this is a genuinely good practice already in place, not something this audit needed to fix.
