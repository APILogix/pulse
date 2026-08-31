# 10 — Idempotency and Deduplication Audit

## Automation

| Layer | Mechanism | Status |
|---|---|---|
| Trigger event ingestion | `ON CONFLICT (organization_id, dedupe_key) DO NOTHING` on `automation_events_inbox` insert | VERIFIED WORKING (contingent on schema — see doc 08) |
| Run creation | Unique idempotency key `automation:{orgId}:{workflowId}:{eventType}:{sourceEventId\|\|dedupeKey}`, violation caught as `AutomationConflictError` | VERIFIED WORKING |
| Step creation | `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` | VERIFIED WORKING |
| Action side-effect (external call) | `buildIdempotencyKey()` computed, stable across retries (attempt number deliberately omitted), but **not forwarded into any downstream integration call signature** found in `action-runner.ts` | PARTIALLY IMPLEMENTED — computed, not enforced externally |
| Schedule tick dedup | `dedupe_key = 'schedule:{orgId}:{workflowId}:{dueTimestamp-to-minute}'`, same `ON CONFLICT` pattern | VERIFIED WORKING |

**Risk scenario**: worker restart mid-execution of a step that has a real integration (once one is wired in). Because the idempotency key is stable but not passed to the integration, a restart that causes pg-boss to redeliver the job (at-least-once queue semantics) could result in the handler calling the external provider a second time with no way for that provider to detect the duplicate — unless the specific integration's own API happens to be naturally idempotent (e.g. some webhook receivers dedupe by payload hash on their end, which this system doesn't control). This is a real gap to close before wiring in the first real handler for `notification.send` or similar, not just a theoretical concern.

## Alerting

| Layer | Mechanism | Status |
|---|---|---|
| Alert event fact | Unique idempotency index on `alert_events_v2 (organization_id, idempotency_key, created_at)` | VERIFIED WORKING (per prior hardening report, unified fingerprint fix) |
| Notification job claim | `FOR UPDATE SKIP LOCKED`, prevents double-claim | VERIFIED WORKING |
| Notification delivery attempt | `recordNotificationDelivery` advisory lock + row lock | VERIFIED WORKING |
| Cooldown/breach decision | Per hardening report: now an atomic single-statement claim (exact function name in this codebase is NOT `claimBreachDecision` as the hardening report names it — that literal symbol does not exist in current code; the actual equivalent found was `claimRecovery`, an INSERT...ON CONFLICT+UPDATE CTE) | VERIFIED WORKING functionally, but **naming discrepancy between the hardening report and current code** — flag for doc hygiene, not a functional bug |

## Scenarios simulated (conceptually, from code — no live DB access)

- **Worker restart during automation run**: run stays `running` in DB; pg-boss's own job visibility timeout will eventually redeliver the `automation-run-execute` job (assuming `expireInSeconds: 600` from `enqueueAutomationJob`'s options is honored — confirmed present in code); `claimNextStep`'s `FOR UPDATE OF s SKIP LOCKED` + "no lower-sort_order step in non-terminal-success" constraint means the redelivered execution resumes from the correct next step rather than re-running completed steps. Classification: **WORKING WITH CONDITIONS** — correct resumption logic exists, contingent on the schema-mismatch caveat.
- **Queue redelivery for the same run**: `singletonKey: run:<id>` on the execute job prevents two concurrent deliveries of the *same* run from both being dispatched by pg-boss at once — this is pg-boss's own guarantee, not something the app re-implements.
- **DB retry mid-transaction**: the `ResilientPgBossDb` adapter retries transient Postgres errors (Neon cold-start/idle-disconnect) at the SQL execution layer; whether this could cause a double-send of a job is **NOT VERIFIED** — depends on whether the retry logic distinguishes "query failed before commit" from "commit succeeded but the acknowledgment was lost," which was not confirmed by reading `pgboss.ts` to that level of detail in this pass.
