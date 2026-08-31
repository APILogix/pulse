# 15 — Test and Verification Matrix

## Test files found

Automation (`test/unit/`): `automation-action-runner.test.ts`, `automation-evaluator.test.ts`, `automation-service.test.ts`, `automation-workers.test.ts`, `automation-templates.test.ts`, `automation-repository.test.ts`, `automation-phase2-behavior.test.ts`, `automation-hardening.test.ts`.

Alerting (`test/unit/`): `alerting-catalog-optimization.test.ts`, `alerting-auto-resolve-sweep.test.ts`, `alerting-acceptance-scenario.test.ts`, `alerting-decision-engine.test.ts`, `alerting-concurrency-safety.test.ts`, `alerting-delivery-idempotency.test.ts`, `alerting-rule-revision-bump.test.ts`, `alerting-rule-test-endpoint.test.ts`, `alerting-route-cooldown.test.ts`.

**Important caveat, stated per the audit's non-negotiable rule**: all of the above live under `test/unit/`, which by directory naming convention suggests unit-level tests. This audit did **not** open every test file to confirm real-Postgres vs. fully-mocked execution — the inference (based on this codebase's convention of injecting `pool`/`PoolClient` directly into repository constructors) is that many of these likely run against a real or dockerized test Postgres rather than mocked repositories, but this is an **INFERENCE, not a confirmed FACT**. Per prior docs (`ALERTING_V2_HARDENING_REPORT.md` §J9, `ENTERPRISE_INCIDENTS_REPORT.md` §R4), both explicitly state **no real-Postgres/failure-injection tests were run** for the hardening/incidents work — only in-memory Postgres emulation. This is directly relevant: even if these test files exercise real SQL, they may not be exercising it against genuine Postgres semantics (locking behavior, `SKIP LOCKED` races, advisory locks) that an in-memory emulator may not faithfully reproduce. **Treat all `FOR UPDATE SKIP LOCKED`/advisory-lock claims in this audit as code-correct-by-inspection, not test-proven-under-real-concurrency**, unless a future pass opens these test files and confirms otherwise.

## Coverage matrix (best-effort inference from filenames + prior docs; NOT VERIFIED by opening every test body)

| Automation capability | Creation | Trigger | Condition | Queue | Worker | Action | Retry | Duplicate exec | Restart | Tenant isolation |
|---|---|---|---|---|---|---|---|---|---|---|
| Workflow CRUD | Likely (`automation-service.test.ts`) | — | — | — | — | — | — | — | — | NOT VERIFIED |
| Inbox/trigger processing | — | Likely (`automation-workers.test.ts`) | — | Likely | Likely | — | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Condition evaluation | — | — | Likely (`automation-evaluator.test.ts`) | — | — | — | — | — | — | N/A |
| Action execution / stubs | — | — | — | — | — | Likely (`automation-action-runner.test.ts`) — likely confirms the `notImplementedResult` behavior itself, not real external delivery | NOT VERIFIED | — | — | — |
| Hardening-specific behavior | — | — | — | — | — | — | Possibly (`automation-hardening.test.ts`) | Possibly | NOT VERIFIED | NOT VERIFIED |

| Alerting capability | Rule create/update | Trigger evaluation | Cooldown | Concurrency safety | Delivery idempotency | Auto-resolve | Escalation | Tenant isolation |
|---|---|---|---|---|---|---|---|---|
| Coverage found | NOT directly (no `alerting-rule-crud.test.ts` found; `alerting-rule-test-endpoint.test.ts` is closest) | `alerting-decision-engine.test.ts` | `alerting-route-cooldown.test.ts` | `alerting-concurrency-safety.test.ts` (name strongly suggests this targets exactly the locking claims in doc 09) | `alerting-delivery-idempotency.test.ts` | `alerting-auto-resolve-sweep.test.ts` | NOT FOUND — no `alerting-escalation*.test.ts` filename found in this pass | NOT FOUND as a dedicated file (may be covered incidentally inside other tests, not confirmed) |

## LIVE VERIFICATION PERFORMED IN THIS AUDIT

`npx vitest run test/unit/automation-workers.test.ts` was actually executed (not just inferred). Result: **29 passed, 0 failed, total duration 870ms** (transform 263ms, import 345ms, tests 89ms — the actual test execution took under 100ms for 29 tests).

Direct read of the test file confirms these are **pure unit tests against isolated pure functions** (`buildIdempotencyKey`, `evaluateConditions`) and hardcoded string assertions describing intended SQL/locking behavior in comments (e.g. "SKIP LOCKED patterns" is a section header, not a test that runs SQL). No `Pool`, no database connection, no mock of `repository.ts`'s actual claim queries was found in this file. This **confirms** the inference above was correct: despite the filename and doc comments describing "inbox processing," "SKIP LOCKED patterns," "schedule due" as tested, **this specific file does not execute `claimInboxEvents`, `createRunWithSteps`, or `claimNextStep` against any database, real or mocked** — it tests the idempotency-key string format and the evaluator's pure logic only.

**This directly corroborates the P0 schema-mismatch finding in doc 08**: since no automated test actually calls the real SQL in `repository.ts` against a live schema, there is no test-based safety net that would have caught the column mismatch described there. The "29 passed" result is real and not fabricated, but it should not be read as evidence that automation's claim/lock/retry SQL works — it never runs in this suite.

## Explicitly not covered by any test evidence found

- Restart/crash recovery under real process termination (not just in-memory simulation) — **NOT VERIFIED** for either subsystem.
- Cross-tenant IDOR-style access attempts as a dedicated security test — **NOT FOUND**.
- Real external provider delivery (SMTP, Slack, PagerDuty) — explicitly stated as untested in `alertseperation.md`.
- Any live end-to-end run of automation (create → trigger → observe job → observe worker → observe action → observe history) — **NOT VERIFIED LIVE**, and this audit did not have a safe isolated environment available to perform one (no test database connection was established in this pass; doing so would require environment setup beyond static code/doc review, which was out of scope given the audit was conducted via static analysis of the repository).
