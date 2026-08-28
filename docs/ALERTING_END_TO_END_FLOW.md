# Alerting — Complete End-to-End Flow

Traced from actual code, not from design intent. Every stage names the file that
executes it, the database it touches, and the process it runs in.

**Three processes are involved. Keeping them straight is the key to the whole design:**

| Process | Entrypoint | Owns |
|---|---|---|
| **API** | `src/main.ts` | HTTP ingest intake, incident/rule read+write APIs |
| **Ingestion worker** | `src/shared/workers/ingestion-worker-main.ts` | Telemetry persistence + outbox write |
| **Alert worker** | `src/shared/workers/main.ts` / `alert-workers-main.ts` | Evaluation, decision, incidents, notification dispatch, delivery |

**Three datastores:**

| Store | Holds |
|---|---|
| **PRIMARY (control-plane)** | rules, bindings, connectors, orgs/projects/users, **incidents**, **incident timeline**, `pgboss.job` |
| **Log DB** | telemetry (`events_*`), `telemetry_outbox`, alert event facts (`alert_events_v2`), runtime state, notification jobs, delivery attempts |
| **Redis** | cooldown fast-path only — never a source of truth |

---

## Stage map (high level)

```text
 1  SDK  ──HTTP──▶  API: validate, chunk, enqueue           [PRIMARY: pgboss.job]
                         │
                         └──▶ 202 ACK to SDK   ◀── durability boundary #1
 2  Ingestion worker: BEGIN
      ├─ telemetry INSERT                                   [Log DB]
      ├─ appendTelemetryOutbox()  ← SAME transaction        [Log DB]
      └─ COMMIT                                             ◀── durability boundary #2
                         │
      ═══════════════════╪═══ ASYNC BOUNDARY (ingestion is done; it never waits) ═══
                         │
 3  Alert worker: TelemetryOutboxRelay claims outbox rows    [Log DB, SKIP LOCKED]
                         │
 4  ──▶ alert.evaluate.fast          (event-driven, ~1s)
    ──▶ alert.evaluate.window        (cron, 5s)   ─┐
    ──▶ alert.evaluate.operational   (cron, 30s)   ├─ read pre-aggregated rollups
    ──▶ alert.evaluate.ai            (cron, 300s) ─┘
                         │
 5  Rule resolution: catalog snapshot → effective rule       [PRIMARY, cached 60s]
 6  Condition evaluation: readPath + operator + AND/OR
 7  Canonical fingerprint (alertIdentityHash)
                         │
              ┌──────────┴──────────┐
         NOT matched            MATCHED
              │                     │
 8a  claimRecovery()        8b  Redis probe (fast filter)
     (atomic)                   claimBreachDecision() ← AUTHORITATIVE fire gate
              │                     │                       [Log DB, atomic]
              └──────────┬──────────┘
                         │
 9  AlertDecisionEngine.decide()
      ├─ persistIncident()  openOrReuse / resolveByFingerprint  [PRIMARY]
      │                     + appendEvent (timeline)            [PRIMARY]
      └─ ONE Log DB transaction:                                [Log DB]
           lockState → appendEvent(idempotent) → routing.resolve()
           → transitionAlert → upsertState(+incidentId)
           → appendHistory → insertNotificationJobs → appendLedger
                         │
10  alert.notification-router  (cron 10s + on-demand)        [Log DB, SKIP LOCKED]
                         │
              ┌──────────┼──────────────────┐
          in_app     managed email     connector-backed
              │          │                  │
11            │   connector.v2.email   connector.v2.<provider>
              │          │                  │
12            │   processManagedEmailJob   NotificationDispatcher
              │   → SMTP directly          → dedup → idempotency
              │                            → rate limit → circuit
              │                            → provider.send()
              ▼          ▼                  ▼
        mark sent    email out        Slack/PagerDuty/Webhook/…
```

---

# Stage 1 — SDK → API intake

**Process:** API · **Files:** `ingestion/routes.ts`, `ingestion/controller.ts`, `ingestion/service.ts`

1. `POST /api/v1/ingest/<type>` hits a route registered from the data-driven `TYPED_INGEST_ROUTES` table (`routes.ts:235-241`).
2. `controller.ingestTyped(type)` → `IngestionService`:
   - batch size checked against `INGESTION_MAX_BATCH_SIZE` → `413 BATCH_TOO_LARGE` if exceeded
   - per-project token bucket (process-local, **no Redis**) → `429`
   - queue-depth backpressure: `refreshQueueDepth()` is refreshed **in the background** and read from cache, so the request path never awaits it → `503 CIRCUIT_OPEN` over threshold
   - envelope-level validation only; full Zod normalization happens worker-side
3. Batch is chunked into pg-boss jobs by count **and** byte budget (`INGESTION_JOB_CHUNK_SIZE` / `INGESTION_JOB_MAX_BYTES`), one job per `(type, chunk)`.
4. `enqueueIngestJobs()` bulk-inserts into `pgboss.job` — **in the PRIMARY database**.
5. **`202 Accepted`** returned at `controller.ts:174`.

> **Durability boundary #1.** Once `enqueueIngestJobs()` resolves, the batch survives a crash of any process. Nothing is buffered in memory.

**Job priority / tenant fairness** (`queue/ingest-queues.ts`): `PLAN_WEIGHT` (enterprise 1000 → free 200) combined with `TYPE_URGENCY` (error/message/cron 100 → profile/replay 10), plus a per-org in-flight budget (`TENANT_INFLIGHT_LIMIT`, enterprise 24 → free 2) and `FAIRNESS_AGE_BOOST` so deferred jobs eventually win. One tenant cannot monopolise a queue.

---

# Stage 2 — Ingestion worker: persist + outbox

**Process:** Ingestion worker · **File:** `ingestion/workers/event-processor.ts`

```
admission.run(...)                        # FIFO write semaphore (bounded permits)
  client = connectWithAbort(writePool)    # dedicated telemetry WRITE pool
  BEGIN                                             (:547)
    applyIngestionTransactionSettings(client)        (:549)  SET LOCAL synchronous_commit, lock_timeout…
    ├─ errorIngestionService.ingestBatch(...)        (~:620) # type === 'error'
    └─ writer.writeBatchDetailedInTransaction(...)   (~:666) # all other types
    appendTelemetryOutbox(scoped, client)            (:658 / :669)
  COMMIT                                            (:679)
→ pg-boss job ACK  (downstream of COMMIT)
```

`appendTelemetryOutbox()` (`pipeline/telemetry-writer.ts:706`) is **one statement with three CTEs**:
1. `input` — 9-array `UNNEST` (whole batch in one round trip)
2. `reserved` — reserves `alert_runtime_idempotency_keys` (`namespace='telemetry_outbox'`, key = `signal_kind:event_id`), `ON CONFLICT DO NOTHING`
3. `inserted` — inserts `telemetry_outbox` rows joined to `reserved`

Only events matching `isFastPathSignal()` are written to the outbox — not all telemetry.

> **Durability boundary #2.** The telemetry row and its outbox row become visible **atomically**. The job is only ACKed after COMMIT, so redelivery is safe (inserts are idempotent).
>
> **This is where ingestion's involvement ends.** It does not call alerting, does not wait for it, and cannot be slowed by it. There is no import from `modules/ingestion` → `modules/alerting`, and no DB trigger from ingestion tables into alerting tables.

---

# Stage 3 — Outbox relay (async handoff)

**Process:** Alert worker · **File:** `alerting/runtime/telemetry-outbox-relay.ts`

Driven by a **1-second** timer (`queue.ts:350-353`) publishing `alert.telemetry-outbox-relay`, deduped by a per-second `singletonKey`.

`run(limit = 250)` executes one claim statement:

```sql
WITH claimed AS (
  SELECT id, created_at FROM telemetry_outbox
   WHERE published_at IS NULL
     AND fast_path = TRUE
     AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '2 minutes')
   ORDER BY created_at ASC
   LIMIT $1
   FOR UPDATE SKIP LOCKED          -- concurrent relays never collide
)
UPDATE telemetry_outbox t
   SET claimed_at = NOW(), claimed_by = $2, attempts = attempts + 1
  FROM claimed WHERE t.id = claimed.id
RETURNING …
```

Claimed rows are grouped by `(organization_id, project_id, environment)` and published as `alert.evaluate.fast` jobs. Limit clamped to `[1, 1000]`. The 2-minute staleness window means a crashed relay's rows are re-claimable.

**Second fast-path trigger:** `alert.error-group-regressed` → `evaluateFast()` with a synthetic error signal (bypasses the outbox).

**Third:** a connector circuit opening enqueues `alert.evaluate.fast` with a `connector.failure` signal — see Stage 12.

---

# Stage 4 — Evaluation triggers

**File:** `alerting/queue.ts:340-359`

| Queue | Trigger | Cadence | Data source |
|---|---|---|---|
| `alert.evaluate.fast` | outbox relay / error regression / connector failure | event-driven (~1s) | the event payload itself, **in memory** |
| `alert.evaluate.window` | `setInterval` | **5s** | `request_metrics_1m`, `log_metrics_1m`, … |
| `alert.evaluate.operational` | `setInterval` | **30s** | `runtime_metrics_1m`, `service_metrics_1m`, `endpoint_metrics_1m`, … |
| `alert.evaluate.ai` | `setInterval` | **300s** | `ai_metrics_1m`, `ai_metrics_1h` |

Periodic tiers call `activeRuntimeOrganizations()` and fan out one job per org, deduped by `singletonKey: <queue>:<orgId>:<timeBucket>` so overlapping ticks collapse.

> **Critical distinction:** the fast tier evaluates the **raw event in memory** — no aggregation query. The periodic tiers read **pre-aggregated rollup rows** produced independently by the `analytics-engine` workers (`PERCENTILE_CONT`, `GROUP BY GROUPING SETS`). Alerting itself performs **zero** aggregation.

### 4a — Rollup freshness gate (periodic tiers only)

`evaluateTier()` rejects stale buckets before evaluating:

| Tier | Rollup granularity | Max staleness | Derivation |
|---|---|---|---|
| window | 60s | **180s** | 3 buckets |
| operational | 60s | **300s** | 5 buckets |
| ai | 3600s | **7200s** | 2 buckets |

Stale scope → `summary.stale++`, `alert_evaluation_stale_total`, warning log, **no decision**. This stops a stalled analytics pipeline from either firing on old data or silently reporting "healthy".

---

# Stage 5 — Rule resolution

**Files:** `alerting/runtime/rule-catalog.ts`, `alerting/policy/resolve-rule.ts` · **DB:** PRIMARY (60s LRU cache)

1. `loadCatalogSnapshot(orgId, tier)` — **3 queries per tick for the whole org**, not per rule. Cache invalidated synchronously on every rule CRUD.
2. `snapshot.resolveRulesForScope(scope)`:
   - no `projectId` → returns `[]` (never evaluates org-wide without project context)
   - candidates = rules where `project_id IS NULL OR project_id = scope.projectId`
   - `resolveEffectiveRule(rule, conditions, bindings, scope)` folds `alert_rule_bindings` shallow→deep (org → project → environment → service → endpoint). Deeper scopes override severity, cooldown, dedup window, consecutive-breaches, thresholds, channels.
   - **`requireProjectSubscription` gate**: an org-level catalog rule does **not** silently apply to every project — the project must have its own binding.
   - disabled/unsubscribed → skipped
3. Result: `{ rule, effective }` pairs. Zero control-DB queries per rule (pure in-memory fold).

---

# Stage 6 — Condition evaluation

**File:** `alerting/evaluator.ts` · pure, no I/O

```
evaluateCandidate()
  ├─ build EvaluableCondition[] from effective.conditions
  ├─ hasRelevantMetrics guard → if no condition's fieldPath resolves,
  │    skip + alert_evaluation_skipped_total{reason="no_relevant_metrics"}
  └─ evaluateRule(payload.values, conditions)
       ├─ readPath(payload, fieldPath)     # dotted path, camel/snake fallback,
       │                                    # metric-object unwrap (p95→value→ms→avg→…)
       ├─ evaluateCondition(op, actual, expected)
       │    gt/gte/lt/lte  → numeric, fails closed on null/non-numeric
       │    eq/neq         → strict, with String() fallback for boolean-as-string
       │    exists         → 0 and "" count as present; null/undefined do not
       │    contains/in/regex → invalid regex fails closed
       │    unknown op     → false (fails closed)
       └─ combine: same conditionGroupId = OR; groups + ungrouped required = AND
            isRequired:false ungrouped = OPTIONAL (reported, does not gate)
            all-optional rule → at least one must pass
```

---

# Stage 7 — Canonical fingerprint

**File:** `alerting/runtime/alert-fingerprint.ts`

```
alertIdentityHash({ organizationId, projectId, environment, ruleId, policyId, dimensionKey })
  → sha256("org:project:env:rule:policy:dimensionKey")
```

`dimensionKey` is built **only from the rule's configured grouping dimensions**, allow-listed (`route`, `endpoint`, `service`, `environment`, `status_code`, `method`, `severity`, `host`) and capped at 5. Route values pass through `normalizeRoute()`.

| Rule config | `/users/123` vs `/users/456` | `/users` vs `/products` |
|---|---|---|
| `groupBy: ['route']` | same (`/users/:id`) → **one** alert | different → **two** alerts |
| no route grouping | same → one alert | same → one alert |

> **Computed BEFORE the matched/unmatched branch.** Previously it was computed after, so a grouped alert fired under its dimension key but "recovered" under `global` — a different key — meaning grouped alerts never resolved. This is one canonical function; the Redis cooldown key, `alert_events_v2.fingerprint`, `alert_event_state.alert_key`, and `alert_incidents.fingerprint` all derive from it.

---

# Stage 8 — Fire / recover gate

### 8a — NOT matched → recovery

```
claimRecovery({ scopeHash, … })        # atomic, Log DB
  WITH locked AS (INSERT … ON CONFLICT DO UPDATE last_evaluated_at
                  RETURNING is_breaching AS prev_breaching)
  UPDATE … SET consecutive_breaches = 0, is_breaching = FALSE,
               last_recovered_at = CASE WHEN prev_breaching THEN $9 …
  RETURNING prev_breaching AS recovered
```
Exactly **one** concurrent caller observes the breaching→healthy edge, so only one recovery alert is emitted. `recovered=true` → `appendDecision(kind='recovered')` with the **same** `alertKey`.

### 8b — MATCHED → cooldown + breach gate

**Step 1 — Redis fast-path filter (optional, never authoritative):**
```
acquireCooldown()  → SET key val EX ttl NX   # atomic at Redis
```
Only a *definitive* `!acquired && !fallback` short-circuits. Any degraded/fallback result falls through. Key = `alert:v1:cooldown:{org}:{project}:{rule}:{fingerprint}` — fingerprint-scoped, so `/users` cannot suppress `/products`.

**Step 2 — AUTHORITATIVE gate (`claimBreachDecision`, Log DB, one statement):**
```sql
WITH locked AS (
  INSERT INTO alert_rule_eval_state (…) VALUES (…, 0, FALSE, $9)
  ON CONFLICT (scope_hash) DO UPDATE SET last_evaluated_at = $9
  RETURNING consecutive_breaches AS prev_breaches,
            is_breaching        AS prev_breaching,
            last_fired_at       AS prev_fired_at
)
UPDATE alert_rule_eval_state s
   SET consecutive_breaches = CASE WHEN l.prev_breaching THEN l.prev_breaches + 1 ELSE 1 END,
       is_breaching         = TRUE,
       last_fired_at        = CASE WHEN <fire cond> THEN $9 ELSE s.last_fired_at END
  FROM locked l WHERE s.scope_hash = $1
RETURNING s.consecutive_breaches, <fire cond> AS fired
```
`INSERT..ON CONFLICT DO UPDATE` takes a row lock the outer `UPDATE` holds for the rest of the statement, so concurrent writers serialize. The counter is incremented **in the database**. `fired` is derived from the row's *previous* `last_fired_at`.

**Result:** exactly one caller per cooldown window gets `fired = true`.
**Redis outage ⇒ no duplicate alerts** — at worst an extra DB round trip.
`indeterminate` (row vanished) ⇒ **fail closed**, log error, `alert_evaluation_failed_total{reason="indeterminate_state"}`.

Outcomes: `!shouldFire` → suppressed (awaiting N breaches) · `inCooldown` → suppressed · else → **FIRE**.

---

# Stage 9 — Decision, incident, notification jobs

**File:** `alerting/decision/decision.engine.ts` · touches **both** databases

```
decide(candidate)
 │
 ├─ 0. reject if projectId present but bindingId/effectiveRuleHash missing → suppressed
 ├─ 1. alertKey = candidate.alertKey (passed through verbatim from Stage 7)
 │     idempotencyKey = sha256(alertKey:kind:observedAt)
 │
 ├─ 2. persistIncident()                                    ══ PRIMARY DB ══
 │      kind='fired':
 │        openOrReuse()  INSERT … ON CONFLICT (organization_id, fingerprint)
 │                       WHERE status IN ('open','acknowledged')
 │                       DO UPDATE occurrence_count+1,
 │                                 last_seen_at = GREATEST(…),
 │                                 severity     = GREATEST(…)
 │                       RETURNING …, (xmax = 0) AS was_inserted
 │          → created  ⇒ alert_incident_opened_total
 │          → reused   ⇒ alert_incident_reused_total   (NO new row)
 │        appendEvent('incident_opened' | 'condition_still_breaching')
 │      kind='recovered':
 │        resolveByFingerprint(… AND last_seen_at <= observedAt)   ← staleness guard
 │        appendEvent('incident_resolved')
 │      ── NON-FATAL: try/catch. A primary-DB outage degrades bookkeeping,
 │         never blocks paging on-call. alert_incident_persist_failed_total.
 │
 └─ 3. ONE Log DB transaction                               ══ LOG DB ══
        lockState(client, alertKey)                    FOR UPDATE on alert_event_state
        appendEvent(...)                               CTE reserves
                                                       alert_runtime_idempotency_keys
                                                       (non-partitioned = the real
                                                        uniqueness authority)
          └─ returns null on replay ⇒ incrementDuplicate() (atomic +1), STOP.
                                        No duplicate notification.
        routing.resolve(...)                           project routing = authoritative
        transitionAlert(prev, 'trigger'|'recover')     validated state machine
        upsertState(..., incidentId)                   links Log DB → PRIMARY incident
        appendHistory(...)
        insertNotificationJobs(targets)                same CTE idempotency pattern
        appendLedger(jobs)
 │
 └─ 4. enqueue one alert.notification-router job per created notification job
```

**Why incidents are outside the Log DB transaction:** they live in a different database — there is no distributed transaction. Both failure directions are non-corrupting and **self-heal on the next evaluation tick**, precisely because `openOrReuse()` is idempotent.

---

# Stage 10 — Notification router

**File:** `alerting/runtime/notification-router.ts` · **Trigger:** 10s timer + on-demand per job

```
claimDueNotificationJobs(limit)   -- FOR UPDATE SKIP LOCKED (no double dispatch)
  └─ per job → dispatch(job)
```

| `channel_kind` | Path |
|---|---|
| `in_app` | mark `sent` in Log DB. No transport. |
| `email` + no `connector_id` | **managed email** → `connector.v2.email` carrying `ManagedEmailJobData`. Validates the restricted-delivery contract; re-verifies project owner / org fallback; suppresses if neither is verified. |
| anything else | requires `connector_id` (else suppressed `missing_connector`) → `connector.v2.<channel_kind>` carrying `ConnectorTransportJob` |

Queue name always via `connectorTransportQueue(provider)` — one source of truth. Priority from `CONNECTOR_PRIORITY[severity]`.

> **There is exactly ONE transport family: `connector.v2.<provider>`.** The legacy `connector-send-*` family, its 7 consumers, its handler, and the `ALERTING_V2_READ` flag were deleted — not flagged off. A test asserts no `connector-send*` consumer can be registered.

---

# Stage 11 — Connector V2 transport worker

**File:** `connectors/queue.ts` · one consumer per registered provider, per-provider concurrency

```
for each job on connector.v2.<provider>:
  ├─ isManagedEmailJob?  → processManagedEmailJob() → Stage 12a
  ├─ isConnectorTransportJob? else reject (invalid contract)
  ├─ entitlement check      capability.connectorAccess && isProviderAllowed(kind)
  │                         ENTITLEMENT_UNKNOWN ⇒ blocked
  ├─ TENANT RE-VERIFY       findById(orgId, connectorId)  (org-scoped)
  │                         AND row.organization_id === job.organizationId
  │                         ⇒ one tenant can never deliver via another's connector
  ├─ globalGuards.acquire()  connector_rate_buckets + connector_circuit_state
  │                          denied ⇒ record jobStatus 'queued' (DEFERRED, retry-safe)
  │                          + notification.delivery.rate_limited — does NOT burn
  │                            the attempt budget
  ├─ dispatcher.dispatch()  → Stage 12b
  └─ recordNotificationDelivery(...)   advisory lock + terminal-status guard
     globalGuards.recordSuccess/recordFailure   ← drives circuit transitions
```

---

# Stage 12 — Delivery

### 12a — Managed email (no connector row)

`processManagedEmailJob()`: entitlement → resolve recipient (project owner → org fallback) → `renderEnterpriseAlertEmail()` → `sendEmail()` (SMTP). Transient failures rethrown for pg-boss retry; permanent (`550`/invalid recipient/syntax) recorded `failed`.

Bypasses the dispatcher entirely ⇒ **no `connector_deliveries` row, no circuit breaker**. Logs identifiers only — never the address, subject, or body.

### 12b — Connector dispatcher

**File:** `connectors/delivery/delivery.service.ts`

```
dispatch(row, payload)
 ├─ 1. DEDUP        findDeliveryByDedupKey(connectorId, dedupKey, 5min)
 │                  → hit ⇒ status 'suppressed', return
 ├─ 2. IDEMPOTENCY  insertDeliveryIdempotent()
 │                  pg_advisory_xact_lock(hash(connectorId:correlationId))
 │                  existing 'sent' ⇒ short-circuit
 ├─ 3. RATE LIMIT   consumeRateLimitToken() → retry w/ retryAfterMs
 ├─ 4. CIRCUIT      circuitAllows(30s reset) → open ⇒ schedule retry
 ├─ 5. SEND         instantiate(row) → decrypt config → createConnector(type)
 │                  → connector.send(payload)
 ├─ 6a. SUCCESS     markDeliverySent + usage accounting + audit + circuit success
 └─ 6b. FAILURE     recordCircuitFailure
        ├─ circuit just OPENED ⇒ enqueue alert.evaluate.fast with a
        │    'connector.failure' / 'open_circuit' signal  ──┐
        │    (a connector outage becomes a first-class alert)│
        └─ scheduleRetryOrFail():                            │
             permanent (auth_error / invalid_config /        │
                        invalid_payload) ⇒ NO retry          │
             retryable & attempts < max ⇒ exponential        │
                        backoff + jitter, status 'retrying'  │
             exhausted ⇒ markDeliveryFailed + insertDeadLetter
                                                             │
   ══════════════════ feeds back to Stage 4 ◀────────────────┘
```

**Providers** (7, plugin-registered in `connectors/registry.ts`): Slack, Discord, Teams, PagerDuty, Webhook, Email, SMS. Each implements only `deliver(payload)` — all reliability mechanics live in the dispatcher, never in a provider.

---

# Stage 13 — Background sweeps

| Queue | Cadence | Does |
|---|---|---|
| `alert.telemetry-outbox-relay` | 1s | claim outbox → fast eval |
| `alert.notification-router` | 10s | claim due notification jobs → transport |
| `alert.evaluate.window` / `.operational` / `.ai` | 5s / 30s / 300s | rollup-tier evaluation |
| `alert.escalation-sweep` | 1m | advance due escalation steps, resume expired acks |
| **`alert.auto-resolve-sweep`** | 1m | close incidents past `auto_resolve_at` |
| `connector-delivery-retry` | 1m | replay retryable delivery rows |
| `connector-health-check` | 5m | proactive connector probes |
| `connector-cleanup` | 1h | purge expired OAuth states |
| `alert.cleanup` | daily 03:17 | retention purge |
| circuit-probe timer | 60s | `open` → `half_open` after cooldown |

All cron jobs carry a `singletonKey`, so replicas cannot double-execute.

**Auto-resolve** (`runtime/auto-resolve-sweep.ts`) — was entirely non-functional before:
```sql
UPDATE alert_event_state SET state='resolved', resolution_reason='auto_resolved', …
 WHERE alert_key IN (SELECT alert_key FROM alert_event_state
                      WHERE state='firing' AND auto_resolve_at <= NOW()
                      ORDER BY auto_resolve_at LIMIT $1 FOR UPDATE SKIP LOCKED)
```
Idempotent (clears the predicates it selects on), concurrency-safe, `firing`-only (an acknowledged alert is human-owned). Recorded as a **timeout, not a verified recovery** (`verifiedRecovery: false`).

---

# Stage 14 — Read path (API process)

```
GET /organizations/:orgId/alerting/incidents[...]
  authenticate (JWT + session + revoke checks)
  requireOrgAccess (orgId from ROUTE PARAMS → organization_members membership)
  → IncidentsService → IncidentsRepository (PRIMARY pool)
       every query: organization_id = $N
       sortBy through a SORTABLE allow-list (ORDER BY can't be parameterised)
       search as a bind parameter with JS-side wildcards
       always LIMIT/OFFSET
  timeline  → alert_incident_events (PRIMARY, authoritative, durable)
              fallback: milestones derived from the incident row
  notifications → alert_delivery_attempts_v2 (Log DB, best-effort enrichment,
                  categories only — never provider bodies or credentials)
```

Cross-tenant access returns **404, not 403**, so a status code cannot confirm an id exists elsewhere.

---

# Failure behaviour summary

| Dependency fails | Effect |
|---|---|
| **Redis** | Cooldown falls through to the atomic DB gate. **No duplicate alerts.** Extra DB round trip. |
| **Primary DB** | Incident bookkeeping fails non-fatally; alerts still evaluate and deliver. `alert_incident_persist_failed_total`. |
| **Log DB** | Evaluation and decision stop — this is the correctness boundary. Ingestion unaffected (separate pool). |
| **Analytics rollups stall** | Staleness gate refuses periodic-tier decisions; `alert_evaluation_stale_total`. Fast tier unaffected. |
| **Provider outage** | Circuit opens → deferred, backoff retries, dead-letter after exhaustion; the outage itself becomes an alert. |
| **Worker crash** | Outbox rows re-claimable after 2min; pg-boss redelivers; incident `openOrReuse` and event idempotency keys make replay safe. |
| **Duplicate job** | Idempotency CTE collapses it; `incrementDuplicate()` instead of a second notification. |

# Why ingestion cannot be affected

1. **No code path.** Zero imports `ingestion → alerting`. Coupling is one shared table, written by ingestion and read by alerting.
2. **No synchronous call.** Ingestion commits and ACKs; it never waits for evaluation.
3. **Separate pools.** Ingestion uses a dedicated telemetry write pool; alerting uses the Log DB / control pools.
4. **`SKIP LOCKED`.** The relay cannot block on rows ingestion is inserting.
5. **No per-event alerting work.** One statement per *matched* evaluation, deduplicated onto existing rows.
6. **No trigger.** No DB trigger on an ingestion table writes to an alerting table.

The only shared resources are the `telemetry_outbox` table and the database instance itself — which is why both new incident tables carry explicit autovacuum thresholds, so their churn cannot starve the autovacuum workers `pgboss.job` depends on.
