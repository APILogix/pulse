# Enterprise Incidents — Implementation Report

**Companion docs:** `docs/INGESTION_PROTECTED_SURFACE.md` (Phase 0A contract),
`docs/ALERT_RULE_CORRECTNESS_AUDIT.md` (original audit),
`docs/ALERTING_V2_HARDENING_REPORT.md` (prior V2 migration + reliability work).

## Verification gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (backend) | **0 errors** |
| `npx tsc --noEmit -p tsconfig.app.json` (frontend) | **0 errors** |
| Full backend unit suite | **56 failed / 1960 passed** — identical failure count to the pre-existing baseline of 56; **+36 new passing tests** |
| Ingestion suites (`src/modules/ingestion`) | **11 files / 75 tests passed** |
| Ingestion-critical files modified | **ZERO** (proof in §27) |

The 56 failures are pre-existing and unrelated (`email-templates`, `automation-*`, `billing-*`, `event-analytics`, `project-route-utils`). They failed before this work and are not claimed as fixed.

---

## 1. Current architecture discovered

Phase 0/0A/0B audits established the real runtime flow (verified from code, not assumed):

```text
SDK  --POST /api/v1/ingest/*-->  Fastify (shared PRIMARY pool)
                                  |
                        enqueueIngestJobs()  ->  pgboss.job (PRIMARY db)
                                  |            <-- 202 ACK sent here (controller.ts:174)
                                  v
                        ingestion worker process (own telemetry WRITE pool)
                                  |
                        BEGIN (event-processor.ts:547)
                          telemetry INSERT            -> Log DB
                          appendTelemetryOutbox()     -> telemetry_outbox (SAME txn, 658/669)
                        COMMIT (679)   <-- job ACK is downstream of this
                                  |
                        ~~~~ asynchronous boundary ~~~~
                                  |
                        alert worker process
                          TelemetryOutboxRelay (FOR UPDATE SKIP LOCKED)
                          -> alert.evaluate.fast / .window / .operational / .ai
                          -> AlertRuntimeEngines.evaluateCandidate()
                          -> claimBreachDecision()  (atomic fire gate)
                          -> AlertDecisionEngine.decide()
                          -> alert_notification_jobs -> alert.notification-router
                          -> connector.v2.<provider> -> Dispatcher -> Provider
```

## 2. Problems discovered

| # | Problem | Severity |
|---|---|---|
| P1 | **No incident entity existed.** The UI faked incidents client-side: `incidentsApi` proxied `/events` and `toIncidentView()` mapped `AlertEvent.status` onto a richer `IncidentState` the backend never produced. | High |
| P2 | An `alert_incidents` table existed in the **Log DB** as dead schema — no code read or wrote it. | Medium |
| P3 | That dead table had **no `project_id`**, so incidents could not be project-scoped or project-filtered. | High |
| P4 | It declared a **full `UNIQUE (organization_id, fingerprint)`**, which permanently forbids a second incident after the first resolves — recurrence would be impossible. | High |
| P5 | Existing event dedup was `findActiveEventByFingerprint()` → check → `incrementDuplicate()`: an application-level check-then-insert with a real race window and **no DB constraint backstop**. | High |
| P6 | `alert_event_state.incident_id` and `idx_alert_event_state_incident` already existed but were never populated with a meaningful id. | Low |
| P7 | `IncidentsPage.tsx` / `IncidentDetailPage.tsx` existed but were **unrouted dead code**. | Low |

## 3. Architecture before

```text
Alert match -> alert_events_v2 (Log DB, append-only facts)
            -> alert_event_state (Log DB, mutable projection, PK = fingerprint)
            -> notification jobs -> connector.v2.*

Incidents:  DID NOT EXIST as a queryable entity.
            Frontend synthesized them from /events client-side.
            A dead alert_incidents table sat unused in the Log DB
            with no project_id and a recurrence-blocking UNIQUE.
```

## 4. Architecture after

```text
                        alert worker process (never ingestion)
                                    |
                     AlertRuntimeEngines.evaluateCandidate()
                                    |
                     canonical alertIdentityHash() -> fingerprint
                                    |
                     Redis probe (fast-path filter only)
                                    |
                     claimBreachDecision()  <- atomic fire gate (Log DB)
                                    |
                     AlertDecisionEngine.decide()
                                    |
                     persistIncident()  <-- NEW, non-fatal
                        |                       |
                   kind=fired               kind=recovered
                        |                       |
              openOrReuse()            resolveByFingerprint()
              INSERT..ON CONFLICT       UPDATE ... AND last_seen_at <= observedAt
              (partial unique index)    (staleness guard)
                        |
                 alert_incidents  <-- PRIMARY db, AUTHORITATIVE, has project_id
                        |
                 incident.id --> alert_event_state.incident_id (identifier, not FK)
                        |
                 alert_notification_jobs -> alert.notification-router
                                          -> connector.v2.<provider> -> Provider

  Read path (API process):
     GET /organizations/:orgId/alerting/incidents[...]
       -> IncidentsService -> IncidentsRepository (PRIMARY pool)
       -> SQL filtering/sorting/pagination only
     Timeline/notifications enrich from Log DB, best-effort, never authoritative.
```

## 4b. Table placement decision — which alert tables belong in PRIMARY

An explicit audit of what each Alert page needs and where it lives. **The primary
database already contained ~45 alert tables** (the full legacy set), while Log DB
holds the `_v2` runtime counterparts. So "move alert tables to primary" was mostly
already true; only one genuine gap existed.

| Alert page | Data needed | Table | DB | Verdict |
|---|---|---|---|---|
| Incidents list/detail | incidents | `alert_incidents` | **primary** | ✅ created |
| **Incident timeline** | lifecycle transitions | **`alert_incident_events`** | **primary** | ✅ **created — was in Log DB** |
| Incident notifications | per-retry delivery attempts | `alert_delivery_attempts_v2` | Log DB | ✅ correctly stays |
| Alert Rules | rules + conditions/actions/bindings/revisions | `alert_rules` etc. | primary | ✅ pre-existing |
| Escalations | policies + steps | `alert_escalation_policies/_steps` | primary | ✅ pre-existing |
| Templates / Silences / Routing / Metrics / Dead-letters | — | `alert_templates`, `alert_silences`, `alert_routing_rules`, `alert_metrics`, `alert_dead_letter_events` | primary | ✅ pre-existing |
| Overview | incident counters | `alert_incidents` | primary | ✅ `summary()` |
| Activity | cross-incident feed | `alert_incident_events` | primary | ✅ created |

**Why the timeline had to move.** It previously read `alert_event_history_v2`, which
is `PARTITION BY RANGE (created_at)` under a Log DB policy that explicitly
range-partitions runtime/audit tables *"to support retention pruning"*
(`logdb/00_shared/001_foundation.up.sql:39`). Incident timelines would have been
silently pruned out from under resolved incidents — the identical failure mode that
put incidents in primary. Postmortems and compliance need lifecycle to outlive
telemetry retention.

**Why delivery attempts must NOT move.** One row per attempt *per retry* is
genuinely high-volume and is partitioned for good reason. Duplicating it into
primary would add write amplification next to `pgboss.job`, which is ingestion's
durability boundary. The split is deliberate: **lifecycle is authoritative and
durable (primary); delivery evidence is high-volume and prunable (Log DB)**. The
incident detail page reads lifecycle from primary and enriches with Log DB
attempts best-effort.

**Timeline source precedence:** the durable primary log wins. When it is empty
(incidents created before this table existed, or a failed audit append), the
service falls back to milestones derived from the incident row itself, so the
detail page is never blank. The two are deliberately **not merged** — that would
double-report the same transitions.

## 5. Incident data model

`alert_incidents` (PRIMARY db). Full DDL: `src/db/postgres/primary_db_draft/09_alerting/001_create_alert_incidents.sql`.

| Group | Columns |
|---|---|
| Identity | `id`, `fingerprint`, `dimension_key` |
| **Tenancy** | `organization_id` (FK, CASCADE), **`project_id` (FK, CASCADE)**, `environment` |
| Provenance | `rule_id` (FK SET NULL), `rule_revision`, `binding_id` (FK SET NULL) |
| Classification | `status` (`alert_incident_status` enum), `severity` (`alert_severity`), `title` |
| Grouping facets | `service`, `route` |
| Evaluation snapshot | `observed_value`, `threshold_value` |
| Dedup | `occurrence_count` |
| Lifecycle | `started_at`, `last_seen_at`, `acknowledged_at/_by`, `assigned_to`, `resolved_at/_by`, `resolution_reason` |
| Meta | `labels` (jsonb), `created_at`, `updated_at` |

**Why PRIMARY and not Log DB** (Phase 4): incidents are control-plane/application state, the same class as `alert_rules`, `alert_rule_bindings`, and `connector_configs` which already live there. Log DB keeps telemetry and the high-volume event facts. Write volume is bounded by fingerprint dedup, not telemetry volume — see §28.

**Integrity CHECKs** (the DB-level guard against a partially-applied transition):
- `ck_alert_incident_resolved_shape` — `status='resolved'` ⟺ `resolved_at IS NOT NULL`
- `ck_alert_incident_acknowledged_shape` — `status='acknowledged'` ⇒ `acknowledged_at IS NOT NULL`
- `ck_alert_incident_labels` — `labels` must be a JSON object

## 6. Database migrations

One additive migration, no destructive change:

- **Created** `alert_incidents` + enum `alert_incident_status` (`open`,`acknowledged`,`resolved`), using the codebase's guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_type ...)` pattern.
- **No** column renamed, dropped, or altered on any existing table.
- **No** existing alert history destroyed. `alert_events`, `alert_events_v2`, `alert_event_state` untouched.
- The Log DB `alert_incidents` is **left in place**, deliberately. Per Phase 32 I identified readers/writers (none in TypeScript) but it has an inbound FK from `alert_correlation_groups.incident_id`, so dropping it is a separate sequenced migration, not a side effect of this work. Documented in the migration header.

**Apply with:** `npm run db:primary:draft -- --dir 09_alerting` (optionally `--dry-run` first). Note the audit finding that `npm run db:migrate`'s candidate directories no longer exist on disk, so it is not a reliable path for this file. `schema.sql` must also be regenerated for fresh-DB creation via `npm run db:create:primary`.

## 7. Database indexes

Every index maps to a query this feature issues. Each is justified; the "not indexed" list is equally deliberate.

| Index | Serves | Kind |
|---|---|---|
| `uq_alert_incident_active` | **Correctness backstop**, not performance | UNIQUE, **PARTIAL** on `status IN ('open','acknowledged')` |
| `idx_alert_incidents_org_status_started` | Default list: tenant + status + newest-first | composite |
| `idx_alert_incidents_org_project_started` | Project-filtered list (most common UI view) | composite |
| `idx_alert_incidents_active_lookup` | Overview active counts; evaluator resolve-by-fingerprint | PARTIAL on active |
| `idx_alert_incidents_rule` | Per-rule counts + last-triggered on the Rules page | PARTIAL `rule_id IS NOT NULL` |
| `idx_alert_incidents_org_severity_started` | Severity facet + critical counts | composite |
| `idx_alert_incidents_org_last_seen` | `sortBy=lastSeenAt`, recency feed | composite |
| `idx_alert_incidents_org_resolved` | "Resolved today" / MTTR window | PARTIAL `resolved_at IS NOT NULL` |

**Deliberately NOT indexed:** `environment`, `service`, `route`, `assigned_to`, `dimension_key`. These are low-selectivity secondary facets that always co-occur with `organization_id`, so the leading composites already restrict the scan to a small tenant slice. Each would cost write amplification on an alerting write path. Add only if `EXPLAIN` on real data shows a need.

## 8. Fingerprint design

**Unchanged and reused** — `alertIdentityHash()` is already the single canonical identity function (established in the prior workstream), so no second algorithm was introduced. Incidents key off exactly the same value the Redis cooldown gate and `alert_event_state.alert_key` use.

Material: `org : project : environment : rule : policyId : dimensionKey`, where `dimensionKey` is the sorted `k=v` join of only the rule's **configured** grouping dimensions (`resolveGroupingDimensions()` filters against an allow-list and caps at 5 dimensions).

This satisfies the Phase 2 requirement directly:

| Rule config | `/users` vs `/products` |
|---|---|
| `groupBy: ['route']` | different `dimensionKey` → different fingerprint → **independent incidents** |
| service-level, no route grouping | same `dimensionKey` → same fingerprint → **one incident** |

Cardinality is bounded by the allow-list + 5-dimension cap, so arbitrary telemetry fields cannot explode incident count. Route values pass through `normalizeRoute()`, so `/users/123` and `/users/456` collapse to `/users/:id` — one incident per route template, verified by test.

## 9. Redis cooldown design

**Unchanged.** Already atomic (`SET key val EX ttl NX`) and already keyed on the canonical fingerprint (`alert:v1:cooldown:{org}:{project}:{rule}:{fingerprint}`), not on `ruleId` — so `/users` cannot suppress `/products`. No `EXISTS`-then-`SET` anywhere.

## 10. Redis failure behavior

**Unchanged and already correct.** Redis is a fast-path filter only; the authoritative fire gate is the atomic `claimBreachDecision()` statement in Postgres. Only a *definitive* "already held" (`!acquired && !fallback`) short-circuits; any degraded result falls through to the DB.

Incidents inherit this and add a second, independent Postgres backstop: even if the cooldown gate were bypassed entirely, `uq_alert_incident_active` makes a duplicate **active incident** impossible. Redis outage therefore degrades latency, never incident correctness — neither fail-open storms nor fail-closed suppression.

## 11. Incident lifecycle

```text
(no active incident) --match--> OPEN --ack--> ACKNOWLEDGED
                                 |                |
                                 +----------------+--recover/manual--> RESOLVED
                                                                          |
                                              later match -> NEW incident (recurrence)
```

- **Match, no active incident** → insert `OPEN`.
- **Match, active incident exists** → reuse: `occurrence_count + 1`, `last_seen_at = GREATEST(...)`, `severity = GREATEST(...)`. **Never** a new row.
- **Recovery** → `resolveByFingerprint()` with a staleness guard.
- **Manual** → `acknowledge` / `resolve` / `assign`, each a guarded UPDATE.
- **Recurrence** → the partial unique index only covers active rows, so a new incident is legal once the previous resolved.

Illegal transitions affect zero rows; the service then distinguishes 404 (absent/wrong tenant) from 409 (exists, transition illegal) via a tenant-scoped re-read, instead of reporting a misleading success.

## 12. Notification lifecycle

**Unchanged.** Project routing remains authoritative — no competing global notification policy was introduced. Incident persistence sits alongside, not inside, the notification path:

```text
Alert Rule -> Incident (new) -> existing NotificationRoutingService
           -> alert_notification_jobs -> alert.notification-router
           -> connector.v2.<provider> -> Dispatcher -> Provider
```

Incident identity and notification dedup stay **separate concerns** (Phase 9): the incident's active-uniqueness index governs incident identity; `alert_notification_jobs.idempotency_key` governs notification dedup; the Redis cooldown TTL governs re-notification. One TTL is not overloaded to mean all three.

## 13. Connector V2 migration

Completed in the prior workstream and **still verified clean**: zero references to `connector-send`, `CONNECTOR_SEND_QUEUES`, `ALERTING_V2_READ`, or `CONNECTOR_JOBS.send` in `src/` or `test/`. Escalation routes through `alert.notification-router` → `connector.v2.*`. A migration-proof test asserts no `connector-send*` consumer is ever registered.

## 14. Legacy components removed (this workstream)

- The **fake `incidentsApi`** that proxied `/events` — replaced with a real client. The event endpoints were preserved under a clearly-named `alertEventsApi`, so events remain available as a low-level forensics surface rather than being conflated with incidents.
- The **unrouted dead pages** `IncidentsPage.tsx` / `IncidentDetailPage.tsx` — rewritten against real APIs and routed.
- `useAlertIncidents` (returned client-derived pseudo-incidents) — replaced by `useIncidents` and friends.

## 15–18. Backend APIs, controllers, services, repositories

**APIs** (all under `/organizations/:orgId/alerting`, guard `[authenticate, requireOrgAccess]`):

| Method | Path | Notes |
|---|---|---|
| GET | `/incidents` | paginated, filtered, sorted; `meta:{total,limit,offset,hasMore}` |
| GET | `/incidents/summary` | overview counters, one grouped query |
| GET | `/incidents/:id` | detail |
| GET | `/incidents/:id/timeline` | paginated |
| GET | `/incidents/:id/notifications` | paginated |
| POST | `/incidents/:id/acknowledge` | 409 on illegal transition |
| POST | `/incidents/:id/resolve` | optional `reason` |
| POST | `/incidents/:id/assign` | `null` clears |
| GET | `/incidents/activity` | **global cross-incident feed**, paginated, incident context joined in SQL (no N+1) |
| GET | `/incidents/rule-stats?ruleIds=…` | **batched** active-incident count + last-triggered for ≤200 rules in one request |

`/incidents/activity` filters: `kind`, `projectId`, `incidentId`, `severity`,
`ruleId`, `from`, `to`, `search`. `/incidents/rule-stats` caps the id list at 200
and validates each as a UUID, so the `= ANY(...)` list cannot grow unbounded.

**Filters:** `status`, `active`, `severity`, `projectId`, `environment`, `service`, `route`, `ruleId`, `assignedTo`, `from`, `to`, `search`. **Sorts:** `startedAt`, `lastSeenAt`, `severity`, `status`, `occurrenceCount`, `updatedAt`.

**Controllers** are thin: Zod parse → service → map response, with `withErrorHandling`. No business logic, no SQL. **Service** owns transition legality and DTO mapping. **Repository** owns all SQL and takes `organizationId` first on every method.

Pagination is **offset/limit**, matching the existing alerting standard (`PaginationSchema`) rather than introducing a second convention. `limit` is capped at 200 by Zod, so a client cannot request the whole table.

## 19–23. Frontend

| Page | Route | State |
|---|---|---|
| Incidents list | `/alerts` (index), `/alerts/incidents` | **New**, real API |
| Incident detail | `/alerts/incidents/:incidentId` | **New**, real API |
| Alert events (forensics) | `/alerts/events`, `/alerts/events/:eventId` | Re-pathed, unchanged |
| Overview / Rules / Escalations / Templates / Silences / Routing / Metrics / Dead letters | unchanged | pre-existing |

**API client:** `incidentsApi` (8 methods) + types `Incident`, `IncidentStatus`, `IncidentListQuery`, `IncidentTimelineEntry`, `IncidentNotification`, `IncidentSummary`. `Incident` mirrors the backend `IncidentDto` field-for-field, **including `projectId`**.

**Hooks:** `useIncidents`, `useIncident`, `useIncidentSummary`, `useIncidentTimeline`, `useIncidentNotifications`, `useIncidentMutations`.

**Pagination/filtering/sorting are all server-side.** The filter object is part of the react-query key, so changing a filter refetches rather than narrowing a downloaded page; `meta.total` drives paging, never `data.length`. Filters persist in the URL so an incident view is shareable and survives reload. `placeholderData` keeps the current page visible while the next loads. Loading, empty, and error states each have a distinct branch, and the error branch has a retry.

**Accessibility:** sortable headers are real `<button>`s with `aria-label`, the table has a `<caption class="sr-only">`, every filter control is labelled, and pagination buttons have `aria-label`s.

## 24. Authorization model

Enforced at three layers:

1. **Route** — `authenticate` (JWT + session + revoke checks) then `requireOrgAccess`, which reads `orgId` from **route params** and verifies `organization_members` membership.
2. **Service** — passes `organizationId` into every repository call.
3. **SQL** — every incident query includes `organization_id = $N`. `findById` is `WHERE id = $1 AND organization_id = $2`.

Cross-tenant probes return **404, not 403**, so an attacker cannot use the status code to confirm an id exists in another tenant.

**Injection surface:** `sortBy` cannot be parameterised in `ORDER BY`, so it is mapped through a `SORTABLE` allow-list and falls back to the default on anything unknown — tested with `'started_at; DROP TABLE alert_incidents;--'`. `search` wildcards are added JS-side so the value stays a bind parameter.

## 25. Observability

Added: `alert_incident_opened_total{tier}`, `alert_incident_reused_total{tier}`, `alert_incident_resolved_total{origin}`, `alert_incident_acknowledged_total`, `alert_incident_persist_failed_total{operation}`.

The opened-vs-reused pair is the key operational signal: a high reuse ratio means dedup is working; a sudden spike in *opened* means either a real incident storm or a fingerprint-cardinality regression.

Never logged: connector secrets, tokens, recipient addresses, full telemetry payloads, provider response bodies. The notifications API returns `errorCategory` only, never a raw provider body.

## 26. Tests

`test/unit/alerting-incidents.test.ts` — 27 tests.

| Test | Failure it prevents |
|---|---|
| 2 concurrent matches → 1 incident | Duplicate active incident under concurrency |
| 10 concurrent matches → 1 incident | Same at higher fan-out; all callers get one identity |
| Repeated sequential matches | A new incident per evaluation tick |
| Different grouped routes independent | `/users` and `/products` collapsing into one incident |
| **Recurrence after resolve** | The full-UNIQUE bug that would forbid a second incident forever |
| **Stale evaluation cannot resolve** | A slow worker closing an incident that has since re-breached |
| Resolve with no active incident | Spurious resolve of nothing |
| Every read scoped by `organization_id` | Cross-tenant data exposure |
| `ON CONFLICT` targets the partial index | Silently losing the active-uniqueness backstop |
| `GREATEST` on `last_seen_at`/`severity` | Recency rewind / severity downgrade on reuse |
| Sort allow-list | `ORDER BY` injection |
| Search parameterised | SQL injection via search |
| Filters applied in SQL + `LIMIT` present | In-memory filtering; unbounded responses |
| Ack/resolve/assign guarded transitions | Illegal transitions reported as success |
| Cross-tenant ack → 404 not 409 | Existence disclosure across tenants |
| DTO mapping (4 tests) | `projectId` missing; pg numerics as strings; snake_case leaking |
| Query validation (4 tests) | Unbounded `limit`; malformed `projectId` |

**Concurrency method:** the in-memory Postgres stand-in serializes statements through a promise chain with a `setImmediate` yield inside each — which is how Postgres behaves for writers contending on one unique index. A check-then-insert implementation *would* interleave there and produce two active rows; a single `INSERT ... ON CONFLICT` cannot. The tests are therefore meaningful, not tautological.

## 27. Ingestion regression verification (Phase 30)

| Check | Result |
|---|---|
| Ingestion-critical files modified | **ZERO** — checked the changed-file list against the Tier 1–4 protected list |
| Ingestion imports of alerting | **ZERO** — grep for `modules/alerting` / relative alerting imports in `src/modules/ingestion/**` |
| Incident persistence or Redis cooldown in ingestion | **ZERO** — grep for `IncidentsRepository`, `openOrReuse`, `alert_incidents`, `acquireCooldown` |
| Where `IncidentsRepository` is constructed | Only `alerting.module.ts:52` (API read path) and `runtime/engines.ts:141` (alert **worker** process). Never in ingestion. |
| Ingestion test suites | **11 files / 75 tests PASS** |
| Tier 4 schema objects altered | **None.** No column, index, or trigger added to `telemetry_outbox`, `alert_runtime_idempotency_keys`, `events_*`, or `pgboss.job` |

Structural guarantees: incident writes happen only in `decide()`, which runs exclusively in the alert worker process off the telemetry outbox. There is **one** statement per *matched* evaluation, and repeats fold onto an existing row rather than inserting — so no per-event work of any kind was added. Incident persistence is wrapped in try/catch and is **non-fatal**: a primary-db outage degrades bookkeeping but never blocks paging an on-call engineer, and the failure is counted and logged rather than swallowed.

## 28. Performance impact

**Writes:** one `INSERT ... ON CONFLICT` per matched evaluation, in a worker process. Bounded by fingerprint dedup, not telemetry volume — the same class of write rate as `alert_rules`. No per-event query, no per-event transaction, no new infrastructure (no Kafka, no extra Redis), no concurrency or pool-size increase.

**Reads:** every list is `LIMIT`-bounded with filtering/sorting in SQL and a leading `organization_id` composite index. `summary()` is one grouped scan rather than six `COUNT` queries. `activeCountsByRule()` is a single `= ANY($2)` batch, avoiding N+1 on the Rules page.

**Ingestion protection:** per-table autovacuum thresholds (`scale_factor 0.05`) keep this table's bloat local so it cannot starve the shared autovacuum workers that `pgboss.job` — in the same database — depends on.

**Not measured:** I did not run a load test or `EXPLAIN` against production-scale data, so I make no quantitative latency claim. The above are structural properties verifiable by reading the code and DDL.

## 29. Security impact

- Tenant isolation enforced at route, service, and SQL layers; cross-tenant returns 404.
- `ORDER BY` allow-list and parameterised search close the two injection surfaces a filterable list API introduces.
- Notifications endpoint returns categories/latency only — no provider credentials or response bodies.
- Real FKs with `ON DELETE CASCADE` to `organizations`/`projects`, so tenant deletion cannot orphan incidents.
- No RLS added; isolation remains application-enforced (consistent with the rest of this codebase).

## 30. Remaining risks

**R1 — Migrations are not auto-applied.** Two new tables (`alert_incidents`,
`alert_incident_events`) require `npm run db:primary:draft -- --dir 09_alerting`,
and `schema.sql` should be regenerated for fresh-DB creation. Until applied,
`persistIncident()` fails its try/catch on every match — alerts still deliver, and
`alert_incident_persist_failed_total` climbs, but no incidents are recorded.
**This is the top deploy-order item.** That counter is the monitor for it.

**R2 — Log DB `alert_incidents` still exists.** Same-named table in two databases is an operational footgun. It is dead schema, but removal is a separate sequenced migration because of the `alert_correlation_groups` FK.

**R3 — `LOG_DB_PRIMARY` fallback.** `ingestion-worker-main.ts:126` uses `LOG_DB_PRIMARY ?? DATABASE_URL`. If unset, telemetry and the primary control plane collapse into one database and every "separate DB" isolation argument weakens. A deployment prerequisite this change cannot fix.

**R4 — No real-Postgres or load verification.** Concurrency guarantees are proven against a serializing in-memory stand-in and by reading the DDL, not against a live Postgres. The partial unique index and `xmax = 0` idiom are standard, but an integration test against real Postgres remains the honest next step. Phase 31/35 failure-injection (real Redis outage, provider outage, worker crash under load) was **not** executed.

**R5 — Overview/Rules/Activity FRONTEND pages not rewired (backend complete).** All
supporting APIs now exist and are tested: `/incidents/summary` (overview counters),
`/incidents/rule-stats` (per-rule active count + last-triggered), and
`/incidents/activity` (global feed). What remains is purely frontend wiring:
`AlertOverviewPage` and `AlertRulesPage` still read their previous sources, and no
Activity **page** consumes `/incidents/activity` yet. The incident list and detail
pages ARE wired. This is presentation work with no schema or contract risk.

**R6 — Inherited gaps unchanged.** From the prior audit and still open: lookback/aggregation config remains decorative (largest correctness gap), absence/inactivity detection, `current_revision` not incremented, effective-rule test API. See `ALERTING_V2_HARDENING_REPORT.md` §J.

**R7 — Fingerprint migration for in-flight alerts (carried over).** The prior workstream changed fingerprint values; in-flight alerts will not match historical keys on deploy. Because incidents now key off the same fingerprint, this also means alerts open at deploy time will produce fresh incidents rather than continuing an existing one.

---

## Acceptance criteria

| Criterion | Status |
|---|---|
| Alerting + ingestion architecture audited | **Done** |
| Ingestion remains isolated; no sync alerting added | **Done** (§27, proven) |
| Canonical fingerprint; grouping semantics respected | **Done** (reused, not duplicated) |
| Route normalization correct | **Done** (`normalizeRoute`, tested) |
| `/users` and `/products` separate when route-grouped | **Done** (tested) |
| Repeated matches don't duplicate active incidents | **Done** (tested at 2 and 10 way) |
| Redis atomic; not source of truth | **Done** (pre-existing, verified) |
| **PostgreSQL enforces active incident uniqueness** | **Done** (`uq_alert_incident_active`) |
| Incident state durable; lifecycle + resolution concurrency-safe | **Done** (incl. staleness guard) |
| Notification dedup separate; project routing authoritative | **Done** |
| Connector V2 only; legacy removed; escalation on V2 | **Done** (prior workstream, re-verified) |
| Tenant isolation verified | **Done** |
| Incident APIs implemented + paginated | **Done** |
| Alert Rule API paginated / Activity API paginated | **Pre-existing** / **Not built** (R5) |
| Indexes query-driven | **Done** (each justified) |
| Frontend server-side pagination/filtering/sorting | **Done** |
| Incident detail exists | **Done** |
| Overview exists / Rules management exists | **Pre-existing, not rewired** (R5) |
| Alert Activity page | **Not built** (R5) |
| Secrets never exposed | **Done** |
| Observability | **Done** |
| Concurrency tests pass | **Done** (27 tests) |
| Failure tests pass | **Partial** — stale-resolve, persist-failure, enrichment-outage covered; no live dependency-outage injection (R4) |
| Connector V2 tests pass | **Done** |
| **Ingestion regression tests pass** | **Done** (75/75) |
| No unnecessary infrastructure | **Done** |
| No unexplained duplication | **Done** — the one same-name collision is documented (R2) |

**Bottom line:** incidents are now a real, durable, project-scoped entity whose uniqueness and recurrence semantics are enforced by the database rather than by hopeful application logic, exposed through paginated tenant-isolated APIs and a working UI — with mechanical proof that no ingestion-critical file was touched and all 75 ingestion tests still pass. Five items remain open (R1–R7), with R1 being the immediate deploy-order prerequisite.
