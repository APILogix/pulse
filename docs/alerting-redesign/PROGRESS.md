# Implementation Progress

One record per increment. Architecture is locked; this file tracks execution against it.

| Increment | Title | Status |
|---|---|---|
| 1 | Stabilize schema ownership | **Implemented and verified** |
| 2 | Rule bindings + Effective Rule Resolution | **Implemented and verified** (ships dormant) |
| 3 | Alert Policy Engine (shadow mode) | Not started |
| 4 | Transactional outbox + relay | Not started |
| 5 | Decision Engine + notification jobs | Not started |
| 6 | Router + connector isolation | Not started |
| 7 | Global rate limit + single circuit breaker | Not started |
| 8 | Window Engine + Fast Engine (cutover) | Not started |
| 9 | Entitlements + usage accounting | Not started |
| 10 | Escalation, preferences, correlation | Not started |

---

## Increment 1 — Stabilize schema ownership

**Goal:** make database ownership explicit and unambiguous with zero behaviour change.

### Delivered

**Migrations (additive only; every `.up.sql` has a matching `.down.sql`)**

| Ref | File | Contents |
|---|---|---|
| L1 | `database/migrations/logdb/00_shared/002_alerting_v2_types.up.sql` | `notification_channel_kind`, `alert_event_kind`, `alert_state`, `notification_job_status`, `alert_usage_kind` + schema note |
| L3 | `database/migrations/logdb/06_alert_runtime/002_alert_runtime_v2.up.sql` | `alert_events_v2`, `alert_event_state`, `alert_event_history_v2`, `alert_rule_eval_state`, `alert_notification_jobs`, `alert_notification_ledger`, `alert_delivery_attempts_v2`, `alert_acknowledgments_v2`, `alert_metrics_v2`, `alert_dead_letter_events_v2` |
| L6 | `database/migrations/logdb/05_connectors_runtime/002_connector_runtime_v2.up.sql` | `connector_deliveries_v2`, `connector_delivery_attempts_v2`, `connector_health_checks_v2`, `connector_test_runs_v2`, `connector_audit_logs_v2`, `connector_dead_letters`, `connector_delivery_status_v2` |
| P7 | `src/db/postgres/canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql` | `connector_rate_buckets`, `connector_circuit_state` |

**Code**

- `src/config/env.ts` — `ALERTING_V2_WRITE`, `ALERTING_V2_READ`, `ALERTING_RUNTIME_POOL_ASSERT`.
- `src/modules/alerting/runtime/runtime-pool.ts` — ADR-0006 boot assertion, role-aware table
  probes, `alerting_runtime_pool_target{role,db}` gauge on the shared `config/metrics.ts` registry.
- `src/modules/alerting/runtime/alert-runtime.repository.ts` — Log DB runtime persistence,
  **required** pool argument, append-only writes, bulk `UNNEST` inserts, `FOR UPDATE` state lock,
  throttle state derived from the ledger.
- `src/modules/alerting/config/alert-config.repository.ts` — control-plane configuration access,
  composes the existing domain repositories (no SQL duplicated, no query changed).
- 12 repositories converted to explicit pool injection (`constructor(db: typeof pool = pool)`)
  across `modules/alerting/**` and `modules/connectors/**`. Defaulted, so all existing construction
  sites are unchanged.
- `src/shared/workers/main.ts` — runs both pool assertions immediately after `logDB.connect()`,
  before any worker registers.

**Tests**

- `test/unit/alerting-runtime-pool.test.ts` — 10 tests: positional missing-table detection, the
  exact audit-B1 failure, database name in the error, bypass path, both gauge states, idempotency,
  unusable-connection probe.
- `test/unit/alerting-pool-boundary.test.ts` — 6 tests: no `config/database` import in
  `alerting/runtime`, no `config/log-database` import in `alerting/config`, runtime pool has no
  default, config pool does, all 12 repositories accept injection.

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| New unit tests | 16/16 passing |
| Regression (`vitest run test/unit --no-file-parallelism`) | 8 failed files / 1 failed test — **identical to pre-change baseline**; 499 tests vs 483, all 16 new ones passing |
| L1/L3/L6 applied to live `logdb` | **PASS** — 6/6 enums, 16/16 tables, 14/14 DEFAULT partitions, 7/7 idempotency indexes, ledger rows recorded exactly once |
| P7 applied to live `apitool` | **PASS** — `connector_rate_buckets`, `connector_circuit_state` created |
| Full gate run (`verify-alerting-runtime.ts --assert`) | **All gates passed**, exit 0 |
| Forward migration from an EMPTY database | **PASS** — all 23 Log DB migrations applied into a fresh scratch DB (179 tables) |
| Rollback (L3 → L6 → L1 `.down.sql`) | **PASS** — v2 tables 0/16, enums 0/6, ledger 0/3, **legacy tables intact** |
| Re-apply after rollback | **PASS** — restored 16/16 tables, 6/6 enums, 3/3 ledger rows |
| Scratch database cleanup | **PASS** — `logdb_migtest` dropped, temp probes deleted |

Note: parallel test runs in this environment are load-flaky (cold-cache runs showed up to 28 failing
files that pass in isolation). `--no-file-parallelism` is the trustworthy comparison and was used.

Reversibility was tested on an isolated scratch database (`logdb_migtest`) created and dropped on the
local server, so no verified table in `logdb` was ever dropped. Docker was unavailable (daemon not
running), which ruled out testcontainers.

### Tooling added during verification

| Script | Purpose |
|---|---|
| `scripts/verify-alerting-runtime.ts` | Read-only gate check: pool attachment, telemetry visibility per pool, Increment 1 objects, partitions, idempotency indexes, both migration ledgers. `--assert` exits 1 on failure. |
| `scripts/apply-migration.ts` | Applies ONE primary migration by filename and records it in `schema_migrations`. Needed because 196 canonical files show as pending in an environment whose schema was built from the compiled bundle — running them all would be unsafe. |
| `scripts/logdb-rollback.ts` | Executes a Log DB `*.down.sql`. The forward runner ignores down files, so the plan's rollback matrix previously had no tooling. Refuses non-disposable databases without `--yes`. |

### Audit findings closed at the schema level

A1, A2, A3 (throttle windows replaced by the append-only ledger), A4, A5, A6, C1, C2, C3, C6.
B1 is now fail-fast rather than silent. C4/C5 have their tables in place; enforcement lands in
Increment 7.

### Risk / rollback

- Nothing reads the new tables; flags default to off, so runtime behaviour is unchanged.
- Rollback: apply the four `.down.sql` files, or simply leave the unused tables in place.
- **Operational prerequisite introduced:** the worker now refuses to boot if the runtime pool cannot
  resolve `events_requests` and `alert_events_v2`. Apply the Log DB migrations before deploying
  workers (migration plan §7 step 1 before step 2), or set `ALERTING_RUNTIME_POOL_ASSERT=false`.

### Outstanding before Increment 2

1. ~~Execute L1/L3/L6/P7 up and down against a real PostgreSQL instance~~ — **DONE.** Applied to live
   `logdb`/`apitool`; full up → verify → down → verify → up cycle proven on a scratch database.
2. ~~Confirm `logdb_migrations` records the three new files exactly once~~ — **DONE** (3/3, count=1 each).
3. ~~Repository contract tests for `AlertRuntimeRepository` against a live Log DB~~ — **DONE.**
   `test/integration/alerting-runtime-repository.test.ts`, 24 tests, all passing. Provisions a
   disposable database, applies the real migration files, exercises every repository method, and
   drops the database afterwards. It surfaced **DEV-003** (below).
4. ~~DEV-002 decision~~ — **RESOLVED via option 2 and implemented.** Telemetry (`events_*`) reads now
   go through the injected Log DB pool; `ai_usage_logs` / `project_usage_minute` / `alert_rules` /
   `alert_events` correctly stay on the control-plane pool. The cross-database preset-seeding query
   was split in two. Firing and auto-resolve are suppressed by default whenever the telemetry pool
   differs from the control-plane pool, pending Increment 8 parity; single-database deployments are
   bit-for-bit unchanged. 26 tests in `test/unit/alerting-evaluator-telemetry-pool.test.ts`.
   **Operator action required to enable alerting: set `ALERTING_EVAL_DRY_RUN=false` after parity.**
5. **DECISION REQUIRED — DEV-003 (blocks Increment 5, not Increment 2).** The idempotency unique
   indexes include the volatile `created_at` partition key, so they cannot detect duplicates. Proven
   by measurement: duplicate alert events, duplicate notification jobs and duplicate delivery
   attempts are all inserted today. This invalidates the "exactly-once decisioning" and "zero
   duplicate notifications" guarantees and would double-count usage. Four options in `DEVIATIONS.md`
   DEV-003; no DDL changed.

### Known limitations after Increment 1

| Limitation | Source | Blocks |
|---|---|---|
| Telemetry-driven alerts still fire nothing in this environment — the evaluators now read the correct database, but firing is intentionally suppressed until parity is validated (`ALERTING_EVAL_DRY_RUN=false`) | DEV-002 (resolved, gated) | alerting goes live at Increment 8 parity |
| An empty duplicate `events_*` remains in the control plane, and the boot assertion cannot detect that condition by table existence | DEV-002 root cause | nothing today; consider dropping the control-plane copies at L10 |
| Duplicate alert events / notification jobs / delivery attempts are possible | DEV-003 | Increment 5, Increment 6 |
| `test/integration/logdb-migrations.test.ts` enumerates Log DB migrations in a hardcoded list that does not include the three new files | pre-existing test design | nothing; extend it when Docker is available |
| Full-project `tsc` fails in the untracked `src/modules/observability/**` module (parallel work, not part of this redesign) | external | project-wide typecheck gate |

### Implementation notes

- Pool injection uses `typeof pool` so no file needed a new `Pool` import — a 1-line diff per
  repository instead of 2, which kept the behaviour-neutral claim easy to review.
- `EventsRepository` was already carrying the identical injection when reached; state was correct and
  consistent with the plan, so it was accepted rather than rewritten.
- One self-correction: a partial `UNIQUE` index on the partitioned `connector_deliveries_v2` was
  removed. NULLs are already distinct in a unique index, so the `WHERE` clause was redundant and a
  portability hazard. All unique indexes on partitioned tables now include the partition key and
  none are partial.

### Technical debt created

| Item | Why | Retire when |
|---|---|---|
| Two runtime schemas coexist (`*` legacy + `*_v2`) | Required for rolling deployment (ADR-0006 / migration plan §2) | L9 view swap, then L10 drop |
| `EventsRepository` / `MetricsRepository` still target legacy control-plane runtime tables | Increment 1 is behaviour-neutral by design | Increment 5 + `ALERTING_V2_READ` |
| `AlertRuntimeRepository` is not yet consumed by any worker | Increment 1 creates persistence only; the Decision Engine is Increment 5 | Increment 5 |
| Only DEFAULT partitions exist on the new tables | Partition manager is L7 | Increment 1 follow-up / L7 |
| In-process rate limiter and breaker still authoritative | Guard tables exist but are unread until the flag lands | Increment 7 |

---

## Increment 2 — Rule bindings + Effective Rule Resolution (COMPLETE)

**Goal:** enterprise rule inheritance across organization → project → environment → service →
endpoint, resolving to exactly one effective rule. Ships dormant — no evaluator consumes it.

### Delivered so far

**Migrations (applied to `apitool`, each with a `.down.sql`)**

| Ref | File | Contents |
|---|---|---|
| P1 | `08_alerting/019_create_alert_scope_types.up.sql` | `alert_scope_type`, `alert_binding_mode`, `alert_action_merge_mode`, `notification_channel_kind` (same name/order as the Log DB copy) |
| P2 | `08_alerting/020_create_alert_rule_bindings.up.sql` | `alert_rule_bindings` + 4 indexes + `updated_at` trigger + 5 CHECK constraints |
| P3 | `08_alerting/021_create_alert_rule_revisions.up.sql` | `alert_rule_revisions` + `alert_rules.current_revision` (closes audit D8) |

`alert_rules.project_id` was **not** modified — it is only deprecated later, at P15.

**Code**

- `alerting/policy/resolve-rule.ts` — the pure ADR-0004 fold: prefix-match scope filtering,
  deepest-wins per field, `disable` with deeper re-enable, `inherit`/`merge`/`replace` action modes,
  deterministic tie-break, per-`field_path` threshold overrides, and a `trace[]` explaining every
  contributing scope. Also `bindingMatchesScope`, `compareBindings`, `hasEqualDepthConflict`
  (the signal for `alert_binding_conflicts_total`).

**Tests** — `test/unit/alerting-effective-rule.test.ts`, 30 tests, all passing:

- The brief's worked example end to end: org 5% → Project A `disable` → Project B 2% →
  production 1% → `/payment` 0.5%, asserting **only** the endpoint threshold executes.
- A rule with no bindings resolves to exactly its own values (the property that makes the P12
  backfill behaviour-identical).
- Order independence (every rotation of the binding array), idempotence, and input immutability.
- Deeper `override` re-enabling a rule disabled at a shallower scope.
- Soft-deleted and cross-organization bindings ignored; only the matching `field_path` overridden.
- Channel/recipient `merge` vs `replace`; deepest escalation policy wins.
- Scope-matching truth table and the tie-break ordering.

### Verification

| Check | Result |
|---|---|
| Resolver unit tests | 30/30 passing |
| Migrations applied to live `apitool` | P1, P2, P3 applied |
| Enums / tables / indexes present | 4/4, 2/2, 3/3 |
| `alert_rules.current_revision` present | yes |
| CHECK: `endpoint` scope without `project_id` rejected | PASS |
| CHECK: invalid environment string rejected | PASS |
| UNIQUE: duplicate organization-scope binding rejected | PASS (NULLS NOT DISTINCT works) |
| Unit suite (serialized) | 8 failed files / 1 failed test — **identical to baseline**, 633 passing |
| Diagnostics on changed files | clean |

Constraint behaviour was verified by attempting the invalid inserts against the live database and
confirming rejection; the verification rows were then deleted.

### Second batch delivered

**Code**

- `alerting/config/bindings.types.ts` — Zod validation for the scope tuple, mirroring
  `ck_alert_rule_binding_scope_shape` so a malformed binding returns 422 instead of a Postgres
  CHECK violation. `null` is accepted explicitly on override fields so a caller can CLEAR an
  override and fall back to the parent scope. Updates cannot move a binding to a different scope.
- `alerting/config/bindings.repository.ts` — primary-pool CRUD (`listByRule`, `listByRuleIds`
  bulk-loader to avoid N+1, `findById`, `create`, `update`, `softDelete`, `listRevisions`).
  Every mutation records an `alert_rule_revisions` snapshot of the whole rule aggregate and bumps
  `alert_rules.current_revision` in the SAME transaction, with `FOR UPDATE` on the rule row so
  concurrent config writes cannot allocate the same revision. Unique-violation is translated to
  `AlertConflictError`.
- `alerting/policy/resolve-threshold.ts` — ADR-0005 threshold layer: `THRESHOLD_PRESET_MAP` for all
  13 seeded keys, `translateLegacyThreshold` (the P14 backfill contract), operator mapping, and
  `resolveEffectiveThreshold` / `resolveAllEffectiveThresholds`.
- `alerting/policy/metrics.ts` — `alert_binding_conflicts_total{scope_level}` on the shared
  registry, labelled by scope level only to keep cardinality bounded.

**Tests** — `test/unit/alerting-effective-threshold.test.ts`, 34 tests, all passing: every one of
the 13 seeded threshold keys is mapped (and the map contains no extras), the three percentiles the
evaluator cannot yet compute are flagged rather than silently dropped, `enabled=false` becomes
`mode='disable'` while still carrying its value, `NUMERIC`-as-string values parse, unmapped keys are
reported, and an unconfigured metric returns `null` rather than zero.

### Third batch delivered — API, backfill and the full test matrix

**API** (`alerting/config/bindings.routes.ts`, registered in `alerting/routes.ts` after
`rulesRoutes`; every route `authenticate` + `requireOrgAccess`, Zod-validated):

| Method | Path |
|---|---|
| GET | `/organizations/:orgId/alerting/rules/:ruleId/bindings` |
| POST | `/organizations/:orgId/alerting/rules/:ruleId/bindings` |
| GET | `…/rules/:ruleId/bindings/:bindingId` |
| PATCH | `…/rules/:ruleId/bindings/:bindingId` |
| DELETE | `…/rules/:ruleId/bindings/:bindingId` (soft delete) |
| GET | `…/rules/:ruleId/effective?projectId=&environment=&service=&endpoint=` |
| GET | `…/rules/:ruleId/revisions` |

`GET …/effective` is the inheritance debugging surface: it echoes the scope it resolved, returns the
single effective rule, the resolved thresholds, `appliedBindingIds`, a `conflict` flag and the full
`trace`. `AlertRuleBindingsService.resolveEffective` increments
`alert_binding_conflicts_total{scope_level}` and logs a warning whenever two bindings tie at the same
depth, so a tie-break is never silent.

**P12 backfill** (`08_alerting/025_backfill_rule_bindings.up.sql`, applied to `apitool`):
one `organization/inherit` binding per org-wide rule, one `project/override` binding per
project-scoped rule, an integrity guard that refuses to run against cross-tenant or orphaned rules,
and revision 1 seeded for every live rule.

### Verification (second pass — Increment 2 exit gate)

| Check | Result |
|---|---|
| Resolver unit tests (`alerting-effective-rule.test.ts`) | 30/30 |
| Threshold unit tests (`alerting-effective-threshold.test.ts`) | 34/34 |
| Repository contract tests (`test/integration/alerting-bindings-repository.test.ts`) | **18/18** |
| Migration up/down tests (`test/integration/alerting-bindings-migrations.test.ts`) | **13/13** |
| P12 idempotency against live `apitool` | `before=39/39 after=39/39 stable=true` |
| Live `apitool` binding invariants | 39 rules / 39 live bindings / 39 revisions; 0 unbound, 0 duplicate scopes, **0 asserting overrides**, 0 enabled mismatches |
| `npx tsc --noEmit` | **zero errors in `modules/alerting`, `modules/connectors` and the new tests** |
| Unit regression (`vitest run test/unit --no-file-parallelism --hookTimeout=60000`) | 10 failed files / 3 failed tests — **8 files / 1 test are the documented baseline; the extra 2 files and 2 tests are all in the untracked `src/modules/analytics-engine/**` module from parallel work** |
| Scratch database / temp script cleanup | verified: `LEAKED=none`, all `_p12*.ts` / `_probe.ts` deleted |

The migration tests execute the real, unmodified `.up.sql` / `.down.sql` files and assert:
enum label order matches the Log DB copy; the four indexes, five CHECK constraints and the
`updated_at` trigger exist; `alert_rules.project_id` is untouched; `current_revision` backfills
pre-existing rows to 1; **P1's rollback fails loudly while bindings still depend on the enums**
(`DROP TYPE` without `CASCADE`); the backfill produces exactly the documented rows and mirrors
`enabled`; a soft-deleted rule is never bound; the cross-tenant guard aborts the whole transaction;
P12's rollback removes only `backfill:v2` rows and leaves hand-created bindings and real revisions
intact; a full `P3 → P2 → P1` rollback leaves `alert_rules`, its conditions and its actions
byte-identical; and re-applying afterwards reproduces the same backfill.

### Defect found and fixed during verification

**Lock-upgrade deadlock in `AlertRuleBindingsRepository`.** The concurrency test
("allocates distinct, gap-free revisions when writes race on the same rule") failed with
`deadlock detected`. Cause: inserting a binding takes an implicit `FOR KEY SHARE` lock on the parent
`alert_rules` row through foreign-key enforcement, and the revision allocator then tried to upgrade
the same row to `FOR UPDATE`. Two concurrent writers each held KEY SHARE and each waited to upgrade,
so PostgreSQL aborted one of them.

Fix: hoist the exclusive lock to the FIRST statement of every mutating transaction
(`lockRuleForWrite`), so concurrent writers queue instead of deadlocking. `requireRule` remains for
read paths, which must not take a write lock. Eight concurrent `create` calls on one rule now yield
revisions 2–9 with no gaps and no duplicates. This was an implementation defect, not an architecture
conflict, so it is recorded here rather than in `DEVIATIONS.md`.

### Implementation notes

- `AlertRuleBindingRecord` was added as the repository's return type. `AlertRuleBindingRow` stays the
  PURE resolver's contract — only the columns the fold reads — so the policy layer cannot start
  depending on `created_by` / `updated_by` / `updated_at`. Typechecking the tests is what surfaced
  the mismatch.
- The integration harness (`test/helpers/primary-alerting-scratch.ts`) builds a minimum prerequisite
  schema and then applies the real migration files. Applying the whole canonical draft tree into an
  empty database was attempted first and fails at
  `03_org_identity/001_fixed_tables.sql` (`billing_provider_type` does not exist) — a pre-existing
  ordering defect in the draft tree, unrelated to this increment and deliberately not papered over.
  A `CREATE DATABASE … TEMPLATE apitool` clone was also rejected: PostgreSQL refuses a template with
  live sessions attached, and this environment normally has them.
- The project `tsconfig.json` includes only `src`, so `test/**` is not typechecked by `npm` scripts.
  The new tests were typechecked with a throwaway config (since removed) and are clean.
- Unit-test failures in this environment are load-sensitive: the default 10s `hookTimeout` produced
  11 spurious file failures that disappear at 60s. Regression comparisons must raise the hook timeout
  and use `--no-file-parallelism`, otherwise the baseline is not comparable.

### Risk / rollback

- **Nothing in the evaluation path reads bindings.** The capability ships dormant; the evaluators are
  wired in Increment 8.
- All 39 backfilled bindings are non-asserting (`mode='inherit'` at organization scope, or
  `mode='override'` at project scope with every scalar NULL), which is why behaviour is unchanged:
  the resolver falls through to the rule's own columns.
- Rollback: `025_…down.sql` removes only backfilled rows; then `021`, `020`, `019` down files in that
  order. Proven end to end on a scratch database.
- The API is additive. Existing rule CRUD routes are unchanged and were registered first, so no path
  shadowing was introduced.

### Technical debt created

| Item | Why | Retire when |
|---|---|---|
| `alert_rules.project_id` and `alert_rule_bindings` both express project scope | Deliberate overlap for a rolling deployment; `project_id` is only deprecated at P15 | P15 (`028_deprecate_legacy_columns`) |
| Revision snapshots are written on binding writes only | Rule/condition/action writes still mutate in place; `rules.service.ts` is not yet on the revision path | Increment 3, when the Policy Engine needs `rule_revision` on every alert |
| `resolve-threshold.ts` flags three percentile keys the evaluator cannot compute | Threshold layer is defined ahead of the metric registry | Increment 8 (`metric-registry.ts`) |
| Integration tests use a fixture prerequisite schema rather than the canonical tree | The draft tree cannot be applied from empty (see notes) | when `03_org_identity/001_fixed_tables.sql` ordering is fixed |

### Known limitations after Increment 2

| Limitation | Blocks |
|---|---|
| No evaluator resolves an effective rule yet, so inheritance has no runtime effect | Increment 8 |
| `alert_binding_conflicts_total` only increments on the `GET …/effective` path, because that is the only caller of the resolver so far | Increment 8 |
| Bindings are not entitlement-checked, so a Free-plan org can create endpoint-scoped bindings | Increment 9 |
| Duplicate alert events / notification jobs / delivery attempts remain possible | DEV-003 — Increment 5, Increment 6 |

### Increment 2 exit criteria — met

Compiles with zero errors in the touched modules; unit, integration, migration, concurrency,
failure-recovery and idempotency tests all present and passing; existing functionality preserved
(0 asserting overrides on live data, regression baseline held); documentation updated.

**Blocking before Increment 5:** DEV-003 still needs a decision. It does not block Increment 3.
