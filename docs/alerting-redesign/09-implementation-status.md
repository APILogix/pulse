# Implementation Status Audit

Date: 2026-07-31

> **Current state:** architecture approved and LOCKED. **Increments 1 and 2 implemented and
> verified** (code + SQL + tests, applied to the live `apitool` / `logdb` databases). Increments 3–10
> not started. Per-increment records live in `PROGRESS.md`; deviations in `DEVIATIONS.md`.
>
> Increment 2 ships **dormant**: rule inheritance is queryable through the API but no evaluator
> resolves an effective rule until Increment 8, and all 39 backfilled bindings are non-asserting, so
> live behaviour is unchanged.

## 1. What was done in the architecture session

**Architecture and documentation only. Zero production code or SQL was changed at that point.**

| Artefact | Path | Lines of intent |
|---|---|---|
| Index + invariants | `docs/alerting-redesign/README.md` | pipeline, layer invariants |
| Phase 1 inconsistency register | `00-inconsistency-register.md` | 25 defects, resolutions, no-regression list |
| Phases 1/2/15 target architecture | `01-target-architecture.md` | layer contracts, ownership matrix, queue table, latency budget |
| Phases 1–4/9–11/14 data model | `02-data-model.md` | full DDL for 18 new/redesigned tables |
| Phase 18 policy engine | `03-policy-engine.md` | 12 stages, `EffectiveAlertPolicy` contract, caching |
| Phases 5/6 engines | `04-evaluation-engines.md` | fast/window/outbox/reconcile, metric registry, no-loss matrix |
| Phases 7/8/9/12/13 | `05-decision-and-delivery.md` | decision steps, state machine, connector isolation, escalation, preferences, correlation |
| Phases 10/11 | `06-entitlements-and-usage.md` | feature keys, plan matrix, 3 enforcement layers, metering points |
| Phase 16 migrations | `07-migration-plan.md` | 26 ordered migrations, backfill SQL, 10-step zero-downtime sequence, rollback matrix |
| Phase 17 implementation plan | `08-implementation-plan.md` | 10 increments × 11 dimensions each |
| ADRs 0001–0011 | `adr/` | 11 records, each with Context/Problem/Options/Decision/Consequences/Migration Impact/Future |

Verification performed: all documents are derived from the completed audit and from files re-read
during this session (migrations, repositories, workers, queue constants, policy-adjacent services). No
claim in these documents is based on assumption about code that was not read.

## 2. What is NOT done (as of Increment 2 completion)

Increment 1 (schema-ownership stabilization) and Increment 2 (rule bindings + effective rule
resolution) are implemented and verified — see `PROGRESS.md`. Still not started:

- Increments 3–10: Policy Engine, transactional outbox, Decision Engine, router + connector
  isolation, global guards, hybrid engines, entitlements/usage,
  escalation/preferences/correlation.
- No queues added, renamed, or rescheduled (neither increment changes queue topology).
- Runtime behaviour is unchanged: `ALERTING_V2_WRITE` / `ALERTING_V2_READ` default to false, nothing
  reads the new `*_v2` tables, and no evaluator consumes `alert_rule_bindings`.
- **Migration and repository contract tests are now executed** against disposable databases on the
  local PostgreSQL server (Docker is unavailable, so testcontainers were replaced by scratch
  databases). Increment 1: 24 contract tests. Increment 2: 18 contract tests + 13 migration tests.

**Increment 2 did add API routes** — seven organization-scoped, authenticated routes under
`/organizations/:orgId/alerting/rules/:ruleId/…` (bindings CRUD, `effective`, `revisions`). They are
additive; no existing route changed.

## 3. Current implementation state of the platform (unchanged by this session)

Verified working today:

| Area | State |
|---|---|
| Ingestion (API → `ingest.*` → worker → `events_*`) | Working. Auth, rate limits, quota pre-check, backpressure, tenant fairness, Zod validation, deterministic event ids, idempotent inserts, DLQ intake, usage rollup, `/metrics` + `/healthz`. |
| Alert rule CRUD + presets | Working. 19 org-level presets seeded on org create and by evaluator backfill. |
| Scheduled evaluation | Working. `alert.evaluate-rules` cron, ~20 metric kinds, cooldown, consecutive breaches, dedup, silences, auto-resolve, recovery. |
| Project thresholds | Working, but as a **separate** engine (`ProjectThresholdWorker`). |
| Alert batching + delivery | Working. `alert.form-batches` → `alert.process-batch`, bulk queries, project subscription/channel resolution with quiet hours and digest filtering, throttling, DLQ + re-drive. |
| Escalation | Working. `alert.escalation-sweep`, step advance, repeats, ack-expiry resume. |
| Connectors | Working. 7 providers, AES-256-GCM credentials with versioning, OAuth PKCE + refresh, idempotent dispatch, retry with jitter, health checks. |
| Frontend | Working. Alert events/rules/escalations/silences/routing/templates/metrics/dead-letters pages wired to real APIs. |

Known-broken or missing today (all addressed by this design, none fixed yet):

| Defect | Register ref |
|---|---|
| Duplicate schemas for 6 runtime tables across two databases | A1–A6 |
| Evaluator reads telemetry via the primary pool while ingestion writes via Log DB | B1 |
| Delivery outcome never closes the loop (`alert_delivery_attempts` stuck at `queued`) | B3 |
| Two unsynchronized circuit breakers; per-process rate limiter | C4, C5 |
| Connector DLQ is an audit-log row with no replay path | C6 |
| No rule inheritance; a project cannot disable or override an org rule | D1 |
| Project thresholds fire independently of rules | D2 |
| Entitlements defined but never enforced anywhere in alerting/connectors | D3 |
| No usage metering for alerts or deliveries | D4 |
| `quota.connectors` unseeded; no SMS or daily/monthly alert limit keys | D5 |
| **Default presets cannot deliver externally** (notify action has no connector) | D6 |
| No rule/action versioning | D8 |
| Minimum alert latency 60–120s; no single-event evaluation | ADR-0001 |

## 4. Capability matrix — current vs. target

"Today" reflects the code as it stands after Increment 2. **Dormant** means the capability is
implemented, migrated and tested but not yet on the evaluation path, so it has no runtime effect until
the increment named in the last column.

| Capability | Today | After redesign | Increment |
|---|---|---|---|
| Organization rules | ✅ | ✅ | — |
| Project rules | ✅ (flat) → ✅ inherited, **dormant** | ✅ (inherited) | 2 |
| One rule → many projects | ✅ **dormant** (bindings + API) | ✅ | 2 |
| Project disable of org rule | ✅ **dormant** (`mode='disable'`) | ✅ | 2 |
| Project/env/service/endpoint override | ✅ **dormant** (5-level scope ladder) | ✅ | 2 |
| Single effective rule (no duplicate evaluation) | partial — resolver + `GET …/effective` ship; evaluator cutover pending | ✅ | 2, 8 |
| Thresholds as a rule layer | ❌ | ✅ | 8 |
| Alert Policy Engine | ❌ | ✅ | 3 |
| Explainable policy trace | ❌ | ✅ | 3 |
| Transactional outbox | ❌ | ✅ | 4 |
| Fast (<500ms) evaluation | ❌ | ✅ | 4, 8 |
| Sub-minute window tiers | ❌ | ✅ (5/15/30s) | 8 |
| Scheduled evaluation as reconciliation | partial | ✅ | 8 |
| Alert state machine incl. `expired` | partial | ✅ | 5 |
| Zero duplicate notifications (idempotency key) | partial | ✅ | 5 |
| Channel abstraction (rules request channels) | ❌ | ✅ | 3, 6 |
| Managed SMTP fallback | ❌ | ✅ | 3, 6 |
| Default presets deliver out of the box | ❌ | ✅ | 6 |
| Connector transport-only isolation | partial | ✅ | 6 |
| Global rate limiting | ❌ | ✅ | 7 |
| Single circuit breaker | ❌ | ✅ | 7 |
| Queryable connector DLQ + replay | ❌ | ✅ | 6 |
| Entitlement enforcement | ❌ | ✅ | 9 |
| Billing-safe usage accounting | ❌ | ✅ | 9 |
| Escalation from immutable snapshot | partial | ✅ | 10 |
| User preferences / vacation / temp mute | ❌ | ✅ | 10 |
| Digest instead of drop | ❌ | ✅ | 10 |
| Recurring maintenance windows | ❌ | ✅ | 3, 10 |
| Correlation, incidents, noise reduction | ❌ | ✅ | 10 |
| AI prioritization hook | partial | ✅ (annotate only) | 10 |
| Rule/action versioning | ❌ | ✅ | 2 |
| Partition lifecycle management | ❌ | ✅ | 1 |

## 5. Recommended next action

Review and approve, in this order, because later increments depend on them:

1. **ADR-0006** (database ownership) — everything else assumes it.
2. **ADR-0004** (inheritance via bindings) — determines the rule API shape.
3. **ADR-0002** (policy engine as a library) — determines latency and testing strategy.
4. **ADR-0003** (outbox in Log DB with relay) — the only cross-database bridge.
5. **ADR-0009 / 0010** — carry product and pricing consequences and will need product sign-off.

On approval, implementation starts with **Increment 1** (schema ownership stabilization), which is
behaviour-neutral, flag-guarded, and independently shippable. I recommend not starting Increment 2+
until Increment 1's boot assertion has run in staging, because it is the check that proves whether the
Log DB and primary pool currently point at the same database — that answer changes the risk profile of
every later step.
