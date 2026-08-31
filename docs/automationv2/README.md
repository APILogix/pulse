# docs/automationv2 — index

This directory contains two distinct kinds of document. Read the status column before trusting any of them.

## Start here

| Document | What it is |
|---|---|
| **[28-event-driven-activation-report.md](./28-event-driven-activation-report.md)** | **Latest.** Activates the alerting → automation event bridge and re-verifies the whole system, then closes every gap disclosed in an earlier revision. Supersedes `25` §H1; corrects its "7 of 17 templates" claim to the verified "6 of 17". Real end-to-end proof includes an actual sent email and real database writes for every non-AI action type. One disclosed, unresolved item remains: an exposed AI provider API key in `src/modules/ai/openai-client.ts` (a security decision for the user, not a bridge-functionality gap). |
| **[26-current-automation-architecture.md](./26-current-automation-architecture.md)** | **How automation works today**, including the event bridge (§3a). The authoritative reference for the automation module. |
| [27-alerting-automation-event-contract.md](./27-alerting-automation-event-contract.md) | The event payload contract the bridge publishes and why it's shaped the way it is. |
| [25-final-verification-report.md](./25-final-verification-report.md) | The repair-phase report (schema, action honesty, retry ownership, idempotency). Still accurate except §H1, which `28` supersedes. |
| [24-action-inventory-and-decisions.md](./24-action-inventory-and-decisions.md) | Per-action implement/remove decisions with live database evidence. Why nine action types and three templates were removed. |

## Audit documents (pre-repair snapshot)

Documents `01`–`23` are the forensic audit that *preceded* the repair. They describe the system **as it was found**, and several of their findings have since been fixed. They are kept because the evidence and reasoning remain useful, but they must not be read as current-state documentation.

| Document | Status |
|---|---|
| `01-executive-summary.md` | **Superseded** by `25`. Its headline P0 (runtime schema mismatch) is fixed. |
| `02-current-architecture.md` | **Superseded for automation** by `26`. Still accurate for the alerting subsystem, which was not modified. |
| `03-automation-rule-inventory.md` | **Superseded** by `24`. Action counts are pre-removal. |
| `04-trigger-and-scheduler-flow.md` | Largely accurate. The "no event producer" gap it identifies is still open. |
| `05-condition-engine.md` | Accurate; the condition engine was not changed. |
| `06-action-engine.md` | **Superseded** by `24` + `26` §5. Described the stub behaviour that no longer exists. |
| `07-worker-and-queue-architecture.md` | Accurate for queue topology. |
| `08-database-schema-and-query-audit.md` | **Historical.** Its P0 finding is fixed; kept as the record of how it was diagnosed. |
| `09-transaction-and-concurrency.md` | Accurate, and now additionally proven by integration tests. |
| `10-idempotency-and-deduplication.md` | **Superseded** by `26` §6. The external-side-effect gap it flags is closed. |
| `11-retry-and-failure-recovery.md` | **Superseded** by `26` §7. The double-retry risk it flags is fixed. |
| `12-security-and-tenant-isolation.md` | Mostly accurate. Note: its "duplicated SSRF guard" concern was investigated and retired — `automation/ssrf.ts` merely re-exports the shared guard. |
| `13-rate-limiting-and-backpressure.md` | Accurate; this gap is still open. |
| `14-observability-and-monitoring.md` | Accurate; unchanged. |
| `15-test-and-verification-matrix.md` | **Superseded** by `25` §D. The test gap it identifies is closed. |
| `16-performance-audit.md` | Accurate; no load testing was performed. |
| `17-dead-code-and-partial-implementation.md` | **Partly resolved.** The automation stubs are gone; the alerting dead queues remain. |
| `18-root-cause-matrix.md` | **Historical.** See `25` §A for which entries are fixed. |
| `19-recommended-target-architecture.md` | Mostly implemented for automation. |
| `20-optimization-roadmap.md` | P0 items done; see `25` §H and `26` §14 for what remains. |
| `21-production-readiness-checklist.md` | **Superseded** by `25` §I. |
| `22-final-forensic-verdict.md` | **Superseded** by `25`. Its verdict predates the repair. |
| `23-final-automation-health-score.md` | **Superseded** by `25` §I. |

## Verification commands

```bash
# Live schema + runtime SQL (transaction rolled back, no residue)
node scripts/verify-automation-runtime.cjs

# Real action side effects + external idempotency (rolled back)
node scripts/verify-automation-integrations.cjs

# Canonical template registry
node scripts/verify-automation-templates.cjs

# Frontend/backend action-type contract drift guard
node scripts/verify-automation-fe-be-sync.cjs

# Alerting -> automation bridge: outbox write, claim, disjointness from
# TelemetryOutboxRelay, end-to-end dedupe (rolled back)
node scripts/verify-alert-automation-bridge.cjs

# Bridge tenant isolation + retry ownership, Primary-DB-only (rolled back)
node scripts/verify-automation-inbox-tenant-isolation.cjs

# The 6 alerting-sourced templates: real conditions against realistic
# payloads, real action side effects where isolable (rolled back)
node scripts/verify-alerting-templates-e2e.cjs

# ONE-TIME real end-to-end proof: sends an actual email through the real
# production dispatch chain to a temporary, self-cleaning connector. Only
# re-run this deliberately (it sends a real message) - not part of routine
# regression checks.
node scripts/verify-real-notification-dispatch.cjs

# Full automation test suite (unit + real-database integration, including
# the event bridge's own disposable-database integration tests and the
# AI-integration wiring tests)
npx vitest run test/unit/automation-*.test.ts test/unit/alert-domain-event-ingest.test.ts test/unit/automation-ai-integration.test.ts test/integration/automation-runtime.test.ts
npx vitest run --config vitest.integration.config.ts test/integration/alert-automation-bridge.test.ts
```

## Current status in one line

Foundation repaired and proven (schema, concurrency, recovery, retry ownership, idempotency, isolation, honest failures). **Event-driven automation works end-to-end for all 6 alerting-sourced templates**, with real proof (a real sent email, real database writes) for every non-AI action; the AI-backed pair is real production wiring that fails closed pending an operational AI-enablement decision. **Production ready for this scope**, with one disclosed, unresolved security item (an exposed AI provider API key, unrelated to the bridge's own correctness) left for the user to resolve. See `28-event-driven-activation-report.md`.
