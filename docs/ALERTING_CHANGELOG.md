# Alerting Workstream — Complete Changelog

Single consolidated record of everything changed across the alerting work: code, APIs, database, tests, and frontend.

**Scope:** two sequential workstreams —
1. **Alerting V2 hardening + legacy transport removal** (correctness, concurrency, Connector V2 migration)
2. **Enterprise incidents** (durable incident entity, APIs, UI)

**Related documents**
| Doc | Contents |
|---|---|
| `ALERT_RULE_CORRECTNESS_AUDIT.md` | Original read-only audit that motivated all of this (incl. §12 frontend page inventory) |
| `ALERTING_V2_HARDENING_REPORT.md` | Workstream 1 detail: before/after architecture, reliability fixes, remaining risks J1–J10 |
| `ENTERPRISE_INCIDENTS_REPORT.md` | Workstream 2 detail: incident model, table-placement decision (§4b), risks R1–R7 |
| `INGESTION_PROTECTED_SURFACE.md` | Pre-committed list of ingestion files that must not change, + impact analysis |

---

## 1. Verification summary

| Gate | Before | After |
|---|---|---|
| Backend `tsc --noEmit` | 0 errors | **0 errors** |
| Frontend `tsc --noEmit -p tsconfig.app.json` | 0 errors | **0 errors** |
| Backend unit suite | 56 failed / 1849 passed | **56 failed / 1960 passed** |
| Net new test failures | — | **0** |
| Net new passing tests | — | **+111** |
| Ingestion suites | — | **11 files / 75 tests pass** |
| Ingestion-critical files modified | — | **ZERO** |

The 56 failures are pre-existing and unrelated (`email-templates` 37, `automation-*`, `billing-*`, `event-analytics`, `project-route-utils`). They failed before this work started and are not claimed as fixed. Baseline was captured by stashing all changes and re-running the suite, so "no regression" is measured, not asserted.

---

## 2. Change volume

**Backend** — 19 files modified (+1,406 / −379), 7 files created (1,977 lines)
**Frontend** — 6 files modified (+1,013 / −99)
**Docs** — 5 created, 1 updated

---

## 3. Database changes

### 3.1 Tables created (PRIMARY / control-plane database)

#### `alert_incidents` — `src/db/postgres/primary_db_draft/09_alerting/001_create_alert_incidents.sql`

The authoritative incident lifecycle store. Previously **no incident entity existed** — the UI synthesized pseudo-incidents client-side from `/events`.

| Group | Columns |
|---|---|
| Identity | `id`, `fingerprint`, `dimension_key` |
| Tenancy | `organization_id` (FK CASCADE), **`project_id` (FK CASCADE)**, `environment` |
| Provenance | `rule_id` (FK SET NULL), `rule_revision`, `binding_id` (FK SET NULL) |
| Classification | `status`, `severity`, `title` |
| Grouping facets | `service`, `route` |
| Evaluation snapshot | `observed_value`, `threshold_value` |
| Dedup | `occurrence_count` |
| Lifecycle | `started_at`, `last_seen_at`, `acknowledged_at/_by`, `assigned_to`, `resolved_at/_by`, `resolution_reason` |
| Meta | `labels` (jsonb), `created_at`, `updated_at` |

**New enum:** `alert_incident_status` = `('open','acknowledged','resolved')`, created with the codebase's guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_type ...)` pattern.

**The critical index** — active-incident uniqueness:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_incident_active
  ON alert_incidents (organization_id, fingerprint)
  WHERE status IN ('open', 'acknowledged');
```
**PARTIAL**, not full. At most one *active* incident per fingerprint, while unlimited resolved history is retained so a later breach legitimately opens a new incident. A full `UNIQUE` — which is what the dead Log DB copy of this table had — would forbid recurrence forever.

**CHECK constraints:** `ck_alert_incident_resolved_shape` (status='resolved' ⟺ resolved_at NOT NULL), `ck_alert_incident_acknowledged_shape`, `ck_alert_incident_labels` (jsonb object).

#### `alert_incident_events` — `001_create_alert_incident_events.sql`

Durable incident lifecycle timeline. Created because the timeline previously read `alert_event_history_v2` in the Log DB, which is `PARTITION BY RANGE (created_at)` under a policy that range-partitions runtime/audit tables *"to support retention pruning"* — so incident timelines would have been silently pruned out from under resolved incidents.

Columns: `id`, `incident_id` (FK CASCADE), `organization_id`, `project_id`, `kind`, `actor_type`, `actor_user_id`, `detail` (jsonb), `occurred_at`, `created_at`.

`ck_alert_incident_event_kind` restricts `kind` to 9 values: `incident_opened`, `condition_still_breaching`, `incident_acknowledged`, `incident_assigned`, `incident_resolved`, `incident_reopened`, `incident_escalated`, `notification_created`, `notification_suppressed`.

### 3.2 Indexes created (10 total, every one query-driven)

**On `alert_incidents` (7):**

| Index | Serves |
|---|---|
| `uq_alert_incident_active` | correctness backstop (above) |
| `idx_alert_incidents_org_status_started` | default list: tenant + status + newest-first |
| `idx_alert_incidents_org_project_started` | project-filtered list (most common UI view) |
| `idx_alert_incidents_active_lookup` | overview active counts; evaluator resolve-by-fingerprint (PARTIAL) |
| `idx_alert_incidents_rule` | per-rule counts / last-triggered (PARTIAL `rule_id IS NOT NULL`) |
| `idx_alert_incidents_org_severity_started` | severity facet + critical counts |
| `idx_alert_incidents_org_last_seen` | `sortBy=lastSeenAt`, recency feed |
| `idx_alert_incidents_org_resolved` | "resolved today" / MTTR window (PARTIAL) |

**On `alert_incident_events` (3):** `idx_..._incident` (per-incident timeline), `idx_..._org_occurred` (global activity feed), `idx_..._org_project_occurred` (project-filtered activity, PARTIAL).

**Deliberately NOT indexed:** `environment`, `service`, `route`, `assigned_to`, `dimension_key`, `kind`, `actor_type`. These are low-selectivity facets that always co-occur with `organization_id`, so the leading composites already restrict the scan to a small tenant slice. Each would cost write amplification on an alerting write path.

### 3.3 Autovacuum tuning (ingestion safety)

Both new tables get explicit per-table storage parameters (`autovacuum_vacuum_scale_factor` 0.05 / 0.1) so their churn cannot starve the shared autovacuum workers that `pgboss.job` — in the same database — depends on.

### 3.4 What was NOT changed

- **No column renamed, dropped, or altered** on any existing table.
- **No existing alert history destroyed.** `alert_events`, `alert_events_v2`, `alert_event_state` untouched.
- **No Tier-4 object touched:** no column, index, or trigger added to `telemetry_outbox`, `alert_runtime_idempotency_keys`, `events_*`, or `pgboss.job`.
- The dead Log DB `alert_incidents` is **left in place** deliberately — it has an inbound FK from `alert_correlation_groups`, so removal is a separate sequenced migration.

### 3.5 How to apply

```bash
npm run db:primary:draft -- --dir 09_alerting --dry-run   # inspect first
npm run db:primary:draft -- --dir 09_alerting
npm run db:migrate:logdb                                  # dead-schema cleanup, run last
```
Then regenerate `src/db/postgres/primary_db_draft/schema.sql` so `npm run db:create:primary` includes the new tables on a fresh database.

**Fixed: `42P01 relation "alert_incidents" does not exist`.** The first attempt to apply
the folder failed. `run-primary-draft-folder.ts` applies files in **lexicographic**
order, and `001_create_alert_incident_events.sql` sorted *before*
`001_create_alert_incidents.sql` — at the point where the names diverge, `_` (0x5F)
precedes `s` (0x73) — so the child table's FK ran before its parent table existed.
The events file is now `002_create_alert_incident_events.sql`, with a header comment
recording that the prefix is load-bearing. Full postmortem in
`ALERTING_DB_DEPLOYMENT_RUNBOOK.md` §1.1, including a pre-existing instance of the
same hazard (`alert_rule_bindings` → `alert_rules`) that is latent only because
`alert_rules` already exists in deployed databases.

> `npm run db:migrate` is **not** a reliable path here — its candidate directories (`canonical_schema`, `canonical_migrations`, …) no longer exist on disk.

---

## 4. APIs created

All under `/organizations/:orgId/alerting`, guarded by `[authenticate, requireOrgAccess]`.

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/incidents` | paginated + filtered + sorted list |
| 2 | GET | `/incidents/summary` | overview counters (one grouped query) |
| 3 | GET | `/incidents/activity` | global cross-incident lifecycle feed |
| 4 | GET | `/incidents/rule-stats?ruleIds=…` | batched active-count + last-triggered for ≤200 rules |
| 5 | GET | `/incidents/:incidentId` | detail |
| 6 | GET | `/incidents/:incidentId/timeline` | paginated lifecycle timeline |
| 7 | GET | `/incidents/:incidentId/notifications` | paginated delivery attempts |
| 8 | POST | `/incidents/:incidentId/acknowledge` | 409 on illegal transition |
| 9 | POST | `/incidents/:incidentId/resolve` | optional `reason` |
| 10 | POST | `/incidents/:incidentId/assign` | `null` clears assignment |

**List filters:** `status`, `active`, `severity`, `projectId`, `environment`, `service`, `route`, `ruleId`, `assignedTo`, `from`, `to`, `search`
**Sorts:** `startedAt`, `lastSeenAt`, `severity`, `status`, `occurrenceCount`, `updatedAt`
**Response envelope:** `{ success, data, meta: { total, limit, offset, hasMore } }`
**Pagination:** offset/limit, matching the existing `PaginationSchema` convention. `limit` capped at 200 by Zod, so a client cannot request the whole table.

All filtering, sorting and pagination execute in SQL. Nothing is filtered in application memory.

---

## 5. Backend code changes

### 5.1 Files created (7)

| File | Lines | Purpose |
|---|---|---|
| `alerting/incidents/incidents.repository.ts` | 632 | All incident SQL. Concurrency-safe `openOrReuse`, staleness-guarded `resolveByFingerprint`, list/activity/summary/rule-stats |
| `alerting/incidents/incidents.service.ts` | 495 | Transition legality, DTO mapping, timeline precedence, activity feed |
| `alerting/incidents/incidents.types.ts` | 124 | Zod schemas + `IncidentDto` wire contract |
| `alerting/incidents/incidents.routes.ts` | 234 | 10 thin endpoints |
| `alerting/runtime/auto-resolve-sweep.ts` | 111 | The sweep that makes `autoResolveAfterMinutes` actually work |
| `09_alerting/001_create_alert_incidents.sql` | 184 | Incident table |
| `09_alerting/001_create_alert_incident_events.sql` | 97 | Timeline table |

### 5.2 Files modified (19)

| File | Δ | What changed |
|---|---|---|
| `runtime/engines.ts` | +357/−… | Redis demoted to fast-path filter; authoritative gate = `claimBreachDecision`; removed redundant post-decision write; recovery uses `claimRecovery`; **fingerprint computation hoisted above the matched/unmatched branch (bug fix)**; rollup staleness gate; all `console.log` removed; metrics; `IncidentsRepository` injected |
| `decision/decision.engine.ts` | +287 | `alertFingerprint()` now delegates to the canonical hash; `candidate.alertKey` passthrough; `persistIncident()` (non-fatal); lifecycle event writes; `incidentId` on `upsertState`; structured logging |
| `runtime/alert-runtime.repository.ts` | +219 | `claimBreachDecision()`, `claimRecovery()`, `claimAutoResolvableAlerts()` — all single-statement atomic claims |
| `connectors/queue.ts` | +205/−… | **Deleted the entire legacy provider-queue loop + handler (~75 lines)**; wired `globalGuards.acquire()` into the V2 handler; guard denial now records `queued` not `failed`; 16 `console.*` removed incl. an email-body dump |
| `runtime/alert-runtime-metrics.ts` | +144 | 16 new counters/histograms |
| `escalation.ts` | +114 | No longer enqueues a transport queue; creates a real notification job → router; per-connector tenant check; active-status check |
| `runtime/notification-router.ts` | +75 | `ALERTING_V2_READ` branching removed; uses `connectorTransportQueue()`; 9 `console.*` removed; stopped logging recipients |
| `runtime/alert-fingerprint.ts` | +45 | Extracted `alertIdentityHash()` as THE single canonical hash |
| `evaluator.ts` | +42 | `isRequired` implemented (was dead config); docstring corrected |
| `runtime/rule-catalog.ts` | +41/−… | 5 `console.log` + per-rule string building removed from the hot path |
| `connectors/job.constants.ts` | +37 | Removed `CONNECTOR_JOBS.send` + `CONNECTOR_SEND_QUEUES`; added `connectorTransportQueue()` / `providerFromTransportQueue()` / prefix constant |
| `queue.ts` | +22 | Registered + scheduled `alert.auto-resolve-sweep` with a `singletonKey` |
| `config/env.ts` | +15 | `ALERTING_V2_READ` removed |
| `alerting.module.ts` | +14 | `incidents` on the decorator; `IncidentsRepository(pool)` |
| `routes.ts` | +6 | Registered `incidentsRoutes` |
| `connectors/connectors.module.ts` | +4 | Expiry keys off the transport prefix |
| `test/unit/modules/connector-queue.test.ts` | ±80 | Retargeted to `connector.v2.*`; added migration-proof assertions |
| `test/unit/alerting-engines-redis-integration.test.ts` | +66 | Mock now faithfully emulates the atomic claim; renamed to reflect the DB-authoritative contract |
| `docs/alertseperation.md` | ±12 | Legacy queue references removed |

### 5.3 Legacy removed (verified: zero references in `src/` and `test/`)

- `CONNECTOR_JOBS.send` constant (`'connector-send'`)
- `CONNECTOR_SEND_QUEUES` — 4 severity queues that never matched the runtime topology
- 7 × `connector-send-<provider>` consumer registrations + the whole legacy handler
- `env.ALERTING_V2_READ` and both branch sites
- `escalation.ts`'s hardcoded `connector-send-${type}` producer
- The **fake** frontend `incidentsApi` that proxied `/events`
- `useAlertIncidents` (returned client-derived pseudo-incidents)

---

## 6. Correctness fixes

| Fix | Was | Now |
|---|---|---|
| **Duplicate alerts under concurrency** | Unlocked read → compute in JS → unlocked write. Redis was the authority and failed open. | Single atomic statement (`INSERT..ON CONFLICT` row lock, returns previous counters). Exactly one caller per cooldown window gets `fired=true`. |
| **Lost breach increments** | Client computed `N+1` and wrote an absolute value | Incremented in the database |
| **Redis outage → duplicate alerts** | Fail-open bypassed cooldown | Redis is a fast-path filter only; only a *definitive* "already held" short-circuits |
| **Grouped alerts never resolved** | Fingerprint computed *after* the matched/unmatched branch, so a fire used the dimension key and its recovery used `global` — a different `alert_key` | Identity computed before the branch; same key for both |
| **Two fingerprint implementations** | Redis key and DB dedup key hashed different inputs | One `alertIdentityHash()`; the engine's key is passed through verbatim |
| **`isRequired` dead config** | Read but never used; docstring promised soft-condition semantics | Implemented, with an all-optional guard so such a rule can't match unconditionally |
| **`autoResolveAfterMinutes` dead config** | Validated, stored, indexed, UI-exposed — nothing read it | `alert_incident_events`-backed sweep, idempotent + `SKIP LOCKED` + overlap guard |
| **Stale rollups fired alerts** | No freshness check | Per-tier staleness gate (180s / 300s / 7200s, derived from rollup granularity) |
| **Circuit breaker never enforced on V2** | Written to but never consulted on the canonical path | `globalGuards.acquire()` gates delivery; denial defers (`queued`) instead of burning retry budget |
| **Escalation had no idempotency** | Enqueued transport directly, no notification-job row | Creates a notification job with a deterministic sha256 key; replays collapse |
| **No incident entity** | UI faked incidents from `/events` | Durable primary-DB entity with DB-enforced active uniqueness |
| **Incident timeline prunable** | Read Log DB partitioned/pruned table | Durable primary-DB lifecycle log |

---

## 7. Observability (21 metrics added)

**Evaluation:** `alert_evaluation_total`, `_matched_total`, `_skipped_total{reason}`, `_failed_total{reason}`, `_stale_total`, `_latency_ms`
**Alert lifecycle:** `alert_triggered_total`, `alert_recovered_total`, `alert_cooldown_blocked_total{gate}`, `alert_deduplicated_total`, `alert_auto_resolved_total`
**Incidents:** `alert_incident_opened_total{tier}`, `_reused_total{tier}`, `_resolved_total{origin}`, `_acknowledged_total`, `_persist_failed_total{operation}`

`cooldown_blocked{gate}` distinguishes the Redis fast-path from the authoritative DB gate. `incident_opened` vs `incident_reused` is the key dedup health signal. `incident_persist_failed_total` is the monitor for an unapplied migration.

**Removed:** 42 `console.*` calls from evaluation/decision/routing/delivery, including one dumping full rendered email bodies and several logging recipient addresses to stdout.

---

## 8. Frontend changes (`pulsiv_fe`)

| File | Δ | What changed |
|---|---|---|
| `pages/act/IncidentsPage.tsx` | +401 | **Rewritten.** Real API, server pagination/filter/sort, URL-persisted filters, loading/empty/error+retry states, a11y (labelled controls, sr-only caption, aria-labels) |
| `pages/act/IncidentDetailPage.tsx` | +383 | **Rewritten.** Header / Trigger / Timeline / Notifications / Resolution sections; ack + resolve actions |
| `modules/alerting/api/alerting.api.ts` | +106 | Replaced the fake `incidentsApi` with a real 10-method client; split events into `alertEventsApi` |
| `modules/alerting/api/types.ts` | +104 | `Incident`, `IncidentStatus`, `IncidentListQuery`, `IncidentTimelineEntry`, `IncidentNotification`, `IncidentSummary`, `ResolveIncidentBody`, `AssignIncidentBody` |
| `modules/alerting/hooks/useAlerting.ts` | +104 | Added `useIncidents`, `useIncident`, `useIncidentSummary`, `useIncidentTimeline`, `useIncidentNotifications`, `useIncidentMutations`; removed `useAlertIncidents` |
| `app/router/protected-routes.tsx` | +14 | Routed `IncidentsPage` at `/alerts` and `/alerts/incidents`, `IncidentDetailPage` at `/alerts/incidents/:incidentId`; moved raw events to `/alerts/events` |

`Incident` mirrors the backend `IncidentDto` field-for-field, **including `projectId`**. Two previously-orphaned page files are now live.

---

## 9. Tests (+111 passing)

| File | Tests | Covers |
|---|---|---|
| `alerting-incidents.test.ts` | 36 | Active uniqueness at 2- and 10-way concurrency; recurrence after resolve; stale-resolve rejection; tenant scoping; `ON CONFLICT` targeting; `GREATEST` no-rewind; sort allow-list; search parameterization; transition legality; DTO mapping; durable-timeline precedence; activity feed scoping; batched rule stats |
| `alerting-evaluator-semantics.test.ts` | 54 | 40-row operator truth table (boundaries, zero, negatives, null/missing, numeric strings, invalid regex); AND/OR; `isRequired`; `readPath` |
| `alerting-concurrency-safety.test.ts` | 13 | Cooldown claim at 2/10-way; breach counting; cooldown boundary (−1ms / exact / after); concurrent recovery; scope independence; fail-closed; fingerprint identity |
| `alerting-auto-resolve-sweep.test.ts` | 8 | Resolve + audit row; history-failure isolation; claim-failure no-throw; overlap guard; query contract |

**Concurrency method:** an in-memory Postgres stand-in serializes statements with a `setImmediate` yield inside each — the behaviour Postgres exhibits for writers contending on one unique index. A check-then-insert implementation *would* interleave and fail these tests; a single `INSERT ... ON CONFLICT` cannot. The tests are meaningful, not tautological.

---

## 10. Ingestion isolation proof

| Check | Result |
|---|---|
| Ingestion-critical files modified | **ZERO** (changed-file list diffed against the Tier 1–4 protected list) |
| Ingestion imports of alerting | **ZERO** |
| `IncidentsRepository` / `openOrReuse` / `acquireCooldown` in ingestion | **ZERO** |
| Where `IncidentsRepository` is constructed | `alerting.module.ts:52` (API reads) and `runtime/engines.ts:141` (alert **worker**) — never ingestion |
| Ingestion test suites | **11 files / 75 tests PASS** |
| Tier-4 schema objects altered | **None** |

Structural guarantees: incident writes happen only in `decide()`, which runs exclusively in the alert worker process off the telemetry outbox. One statement per *matched* evaluation, and repeats fold onto an existing row — no per-event work added anywhere. Incident persistence is try/caught and **non-fatal**: a primary-DB outage degrades bookkeeping but never blocks paging an on-call engineer.

---

## 11. Open items

| ID | Item | Impact |
|---|---|---|
| **R1** | **Migrations not applied.** Run `npm run db:primary:draft -- --dir 09_alerting` + regenerate `schema.sql`. Until then `persistIncident()` fails non-fatally on every match — alerts deliver, no incidents recorded. | **Top deploy-order item.** Monitor `alert_incident_persist_failed_total`. |
| **J1/R7** | Fingerprint values changed, so in-flight alerts won't match historical keys on deploy. Either drain open alerts during the window or backfill. Migration not written. | Required before production |
| R5 | Overview / Rules / Activity **frontend pages** not wired to the new APIs. All three backend endpoints exist and are tested. | Presentation-only, no contract risk |
| J2 | V2 escalation (`SnapshotEscalationWorker`) is still unreachable — `.schedule()` has no call sites and `next_escalation_at` is never set. Legacy `escalation.ts` kept deliberately (deleting it would remove escalation entirely). | Feature incomplete, not broken |
| J4 | `lookback_minutes` / `aggregate_function` remain decorative — real aggregation is a fixed 1m/1h rollup bucket. **Largest remaining correctness gap.** | Needs an architectural decision |
| J5 | Absence/inactivity rules still can't fire from true silence (no rollup row = not evaluated) | Rule class doesn't work |
| J7 | `current_revision` not incremented on rule update; must ship paired with the fingerprint change | Latent |
| J8 | `POST /rules/:id/test` still tests raw conditions, not the binding-resolved effective rule | Misleading results |
| ~~R2~~ | ~~Dead Log DB `alert_incidents`~~ — **RESOLVED.** `logdb/06_alert_runtime/009_drop_dead_alert_incidents.{up,down}.sql` drops `alert_correlation_groups` then `alert_incidents`, behind a `DO $$` guard that raises if either holds rows. `user_notification_preferences` deliberately kept. | Closed |
| R3 | `LOG_DB_PRIMARY ?? DATABASE_URL` fallback — if unset, Log DB and primary collapse into one database and isolation arguments weaken | Deployment prerequisite |
| R4/J9 | No real-Postgres integration run, no load test, no live dependency-outage injection. Concurrency is proven against a serializing stand-in + DDL review. | Verification gap |
| J10 | 56 pre-existing unrelated suite failures | Repo has no green baseline to gate on |
