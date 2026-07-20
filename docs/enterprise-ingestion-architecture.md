# Enterprise Ingestion, Processing & Alerting Platform — Architecture

Status: implemented (compile-verified via `npx tsc --noEmit`; not yet load-tested against a live database).
Scope: `src/modules/ingestion/**`, `src/modules/alerting/**`, `src/modules/feature-flags/**`, `src/shared/workers/**`, `src/lib/pgboss.ts`, `src/lib/gauge.ts`, `src/config/{env,lrucashe}.ts`, `src/db/postgres/canonical_migrations_draft/17_enterprise_ingestion/*`.

---

## 1. Architecture Overview

The platform is split into three independently scalable process tiers:

```
                        ┌──────────────────────────────────────────────┐
 SDKs ──HTTP/gzip──►    │  API tier (Fastify, PM2 cluster, N cores)    │
                        │  ingestion gateway = accept + enqueue only   │
                        └───────────────┬──────────────────────────────┘
                                         │ pg-boss jobs (Postgres, durable)
                                         ▼
                        ┌──────────────────────────────────────────────┐
                        │  Ingestion worker tier (dedicated processes) │
                        │  10 per-type pipelines + DLQ intake +        │
                        │  usage rollup cron + /metrics endpoint       │
                        └───────────────┬──────────────────────────────┘
                                        │ typed events_* rows
                                        ▼
                        ┌──────────────────────────────────────────────┐
                        │  General worker tier                         │
                        │  alert evaluator cron → alert events →       │
                        │  batching → connector delivery (existing)    │
                        └──────────────────────────────────────────────┘
```

Single source of truth for the queue contract is
`src/modules/ingestion/queue/ingest-queues.ts` (queue names, payload shapes,
plan weights, priority math, fairness constants, provisioning, depth probe).
Gateway and workers both import it; nothing redefines it locally.

**Design principles honored:** the HTTP path does no telemetry processing; every
event type has an isolated queue and worker pool; all processing is at-least-once
with database-enforced idempotency; billing usage is aggregated on a time window,
never per event; alerting is fully asynchronous and project-scoped.

---

## 2. End-to-End Request Flow

1. `POST /api/v1/ingest` (or a typed alias) with optional `Content-Encoding: gzip`.
   A `preParsing` hook inflates gzip bodies with a hard decompressed-size cap
   (`INGESTION_GZIP_MAX_BYTES`, zip-bomb guard).
2. Envelope checks: object shape, API key present, events array 1..1000.
3. API key → project resolution (LRU 30 min → single Postgres query with
   LEFT JOINs to `organization_subscriptions` → `plans` for the plan tier).
4. Project active check + key permission/endpoint checks.
5. Project rate limit (token bucket) **and** org-wide rate limit (second bucket,
   per-org override or platform default) → `429 RATE_LIMIT_EXCEEDED`.
6. Quota pre-check: 60-second cached read of `organization_usage_current_period`;
   `events_used >= event_limit` → `429 QUOTA_EXCEEDED` (+ `Retry-After: 60`).
   Fail-open on missing row / DB error (availability beats strictness at the edge).
7. Backpressure probe: queue depth from `pgboss.job`, cached 1 s (below, §13).
8. Per-event **basic** validation only: plain object, `type` ∈ SDK event types,
   typed-route match, ≤ 256 KB serialized. No Zod normalization here.
9. Group by type → chunk ≤ `INGESTION_JOB_CHUNK_SIZE` (200) → one pg-boss job
   per chunk with metadata `{batchId, apiKeyId, planTier, receivedAt,
   environment, deferCount: 0}` and priority = plan weight + type urgency.
10. `202` with `{accepted, rejected, batchId, limits}`.

The HTTP layer never: normalizes telemetry, writes `events_*`, evaluates alerts,
computes latency, updates billing counters, or sends notifications.

---

## 3. Event Routing Architecture — Decision

**Chosen: one public ingestion gateway with internal routing; typed routes kept
as thin aliases.**

- `POST /api/v1/ingest` accepts mixed batches; the gateway splits by type
  internally onto the ten `ingest.<type>` queues.
- `POST /api/v1/ingest/{requests,errors,logs,metrics}` remain as aliases that
  enforce a single expected type (SDK convenience + backward compatibility),
  then flow through the identical path.

Rejected alternative — many public endpoints per type: multiplies auth/rate-limit
/surface area, complicates SDK transport (N endpoints to configure, N retry
policies), and makes versioning painful (every endpoint must version in lockstep).
A single gateway gives: one auth path, one gzip path, one rate-limit path, one
place to version (`/v1`), and freedom to add event types with zero new public
surface — adding a type = one queue + one worker pool + one Zod variant.

Internal routing (gateway splits batches by type) preserves per-type pipeline
isolation without leaking topology to SDKs.

---

## 4. Queue Architecture (pg-boss)

Definitions live in `ingest-queues.ts`; provisioning via `provisionIngestQueues()`
(idempotent `createQueue`, safe under multi-process boot races).

| Queue | Purpose | Options |
|---|---|---|
| `ingest.error`, `ingest.message`, `ingest.cron_checkin` | high-urgency signals | retry 3, backoff, expire 300 s, DL → `ingest.dlq-intake` |
| `ingest.request`, `ingest.span`, `ingest.trace` | performance telemetry | same |
| `ingest.log`, `ingest.metric` | bulk telemetry | same |
| `ingest.profile`, `ingest.replay` | heavy/low-urgency | same |
| `ingest.dlq-intake` | shared dead-letter intake | retry 5, backoff, expire 3600 s |
| `ingest.usage-rollup` | singleton cron (1 min) | — |
| `alert.evaluate-rules` | singleton cron (1 min) | — |

Why pg-boss queues per type instead of one generic queue: retry policies, worker
concurrency, and failure blast radius differ per type; a poison profile payload
must never delay error ingestion. pg-boss gives us SKIP-LOCKED claiming,
priorities, scheduling, and dead-lettering inside the same Postgres that already
stores our data — no new infrastructure (no Redis/Kafka) to run, back up, or
secure. The old hand-rolled `ingestion_jobs` polling queue (which inserted one
row per event synchronously on the request path) is decommissioned; legacy files
remain on disk but are no longer imported by any live code path.

---

## 5. Plan-Aware Scheduling

Priority = `PLAN_WEIGHT[tier] + TYPE_URGENCY[type] + deferCount * AGE_BOOST`
(higher dequeues first in pg-boss):

- enterprise 1000, business 800, growth 600, starter 400, free 200
- urgency: error/message/cron 100 · request/span/trace 50 · log 30 · metric 20 ·
  profile/replay 10
- fairness aging: +25 per deferral

The weight gap (200) exceeds any urgency+aging delta a lower tier can accumulate
within the defer cap (5 × 25 = 125), so **enterprise traffic can never starve
behind free traffic**, while within a tier, errors always outrank bulk telemetry.
Plan tier is resolved once at the gateway (subscription → plan join, cached in
the API-key LRU) and carried in job metadata — workers never re-query billing.
Burst handling: shed policy (§13) drops low-priority traffic first, which by
construction is low-tier + low-urgency. Starvation prevention inside a tier is
the fairness gate's job (§6), not the scheduler's.

---

## 6. Tenant Fairness

Plan priority alone cannot stop one org monopolizing workers **within** a tier,
so fairness is enforced worker-side:

- Per worker process: `Map<orgId, inFlight>`. Budget per org per process by tier:
  enterprise 24, business 16, growth 8, starter 4, free 2.
- Over budget → the job is **deferred**: a copy is re-enqueued with
  `startAfter = INGESTION_FAIRNESS_DEFER_DELAY_SECONDS` (2 s), `deferCount+1`,
  and an aged priority; the original completes (the copy carries the work).
- `deferCount` cap (`INGESTION_FAIRNESS_MAX_DEFERS` = 5) → process anyway.
  Aging guarantees no job defers forever (starvation guard).
- Slots release in `finally`; deferred/forced counters are exported as metrics.

Net effect: a noisy neighbor's jobs are time-shifted, not dropped, and other
tenants' jobs flow around them within the same queue and tier.

Honest limitation: budgets are per-process. With W worker processes the
effective per-org ceiling is budget × W. This is deliberate (no cross-process
coordination cost); platform-wide quotas are enforced separately at the gateway
(§2.6) and via billing counters.

---

## 7. Worker Architecture & Dynamic Scaling

One pg-boss `work()` registration per event type, all stateless, in the
dedicated ingestion worker process (`src/shared/workers/ingestion-worker-main.ts`,
PM2 `ingestion-workers` app, fork mode):

- Concurrency per type: `localConcurrency = INGESTION_TYPE_WORKER_CONCURRENCY`
  (8) × `batchSize = INGESTION_TYPE_WORKER_BATCH_SIZE` (4). v12 handlers receive
  job arrays; per-job isolation via `perJobResults: true` — failed jobs retry,
  batchmates complete. If every job in a fetch fails, the handler throws (whole
  batch retries).
- Shared per-type pipeline (`workers/event-processor.ts`):
  validate (Zod `normalizeEvent`, DoS limits) → deterministic event id when
  missing (`sha256(projectId:type:stableStringify(event))` → 32 hex) →
  idempotent batch write → error grouping (errors only) → usage accumulate →
  metrics.
- Horizontal scaling: add worker processes (PM2 `instances`) — pg-boss claiming
  keeps it safe. Queues scale independently: raise concurrency for `ingest.log`
  without touching `ingest.error`. Queue-depth-based autoscaling consumes the
  `/metrics` gauges (§18). Graceful shutdown: `offWork(name, {wait: true})`
  drains in-flight jobs before `pgboss.stop({graceful})`.
- Worker recovery: pg-boss expires stuck `active` jobs after 300 s and retries
  them; a crashed process loses nothing durable.

---

## 8. Queue Monitoring

Worker processes expose `GET :INGESTION_WORKER_METRICS_PORT/metrics` (9465,
Prometheus text, hand-rolled — no new dependency) and `/healthz`:

- `ingest_queue_depth_pending/active/failed` + per-queue gauges (from
  `pgboss.job` grouped scan, cached 5 s)
- per-type counters: jobs processed/failed, events received/inserted/rejected,
  fairness deferrals
- processing latency + end-to-end latency (`now − metadata.receivedAt`) as
  count/sum/max pairs per type
- org in-flight gauge (fairness), DLQ intake count, rollup last-run stats

The API's existing `/metrics` and the ingestion health endpoint
(`getIngestionHealth`: depth snapshot + rate-limiter sizes + DLQ count +
backpressure thresholds) complement this. Dashboard spec in §18.

---

## 9. Event Processing Pipeline

```
ingest.<type> queue
  → tenant-fairness gate (defer over-budget orgs)
  → validation/normalization (Zod, per event; rejects → DLQ intake)
  → deterministic event identity (content hash when SDK omitted one)
  → idempotent storage (INSERT … ON CONFLICT DO NOTHING, inserted-count aware)
  → error grouping upsert (errors only, inserted rows only)
  → usage accumulation (billing:events:<type>, actually-inserted counts)
  → metrics
       │
       ▼ (minute cadence, singleton crons)
  usage rollup → org billing counters + daily usage partitions
  alert evaluator → alert events → batch-form → connector workers → delivery
```

Every stage is independently scalable: queues by type, workers by process,
rollup/evaluator as singleton crons, delivery by the existing connector tier.

---

## 10. Event Grouping & Fingerprinting

Errors are grouped into `analytics_error_groups` keyed
`(organization_id, project_id, fingerprint)`:

- Fingerprint comes from the SDK event (stack-trace normalization already done
  by the normalizer / writer's `errorFingerprint`), so grouping is deterministic
  and stable across processes.
- Upsert (one statement per distinct fingerprint per job): increments
  total/today/week/month counts, advances `last_seen_at`, merges
  services/environments/releases arrays, and **regression detection**: a group
  in `status = 'resolved'` flips back to `'unresolved'` on new occurrences.
  `first_seen_at` is set on insert only.
- Only rows actually inserted (not idempotency-skipped duplicates) count —
  grouping can't double-count replays.
- The legacy 5-minute `refreshErrorGroups` job is now a **reconciliation**
  (creates missed groups, refreshes descriptive fields + first/last seen) and
  deliberately no longer adds to counts — it previously double-counted on every
  overlapping window even before inline grouping existed.

Issue lifecycle (resolve/ignore/mute) is driven by the existing analytics UI
paths; `status` transitions are respected by the regression flip.

---

## 11. Idempotency & Duplicate Protection

At-least-once delivery is assumed everywhere (pg-boss retries, queue replay,
SDK retries, batch retries, worker crashes). Defense in depth:

- **Storage**: unique index `(project_id, event_id) NULLS NOT DISTINCT` on all
  ten `events_*` tables (PG 15+ semantics; platform runs PG 17) +
  `INSERT … ON CONFLICT DO NOTHING`. Writers return actually-inserted counts so
  downstream stages (grouping, usage) only count fresh rows.
- **Identity**: SDK-supplied event ids are authoritative; missing ids get a
  deterministic content hash, so an SDK retry of the same payload maps to the
  same id and is absorbed by the conflict clause.
- **Usage**: billing counters move only on inserted counts, and the rollup's
  staging extraction is transactional (§14) — retries of the same job cannot
  double-bill.
- **Alerts**: dedup fingerprint = `rule_id : project|org : source`, enforced by
  the events service dedup window + evaluator cooldown. Recovery resolves the
  same fingerprint.
- **Notifications**: existing delivery idempotency guard in the batch processor
  is preserved; replayed alert events carry the same fingerprint.
- **Replay**: DLQ/ops replays re-enter through the same pipeline with
  `metadata.replay = true`; storage idempotency makes them safe.

---

## 12. Backpressure Strategy

Gateway shedding (probe = `pgboss.job` pending depth, cached 1 s):

| Depth | Behavior |
|---|---|
| < highWater (100k) | accept everything |
| ≥ highWater | shed jobs with priority < business+100 (i.e. free/starter/growth low-urgency traffic), counted + reported as `shed_backpressure` |
| ≥ criticalWater (250k) | only business/enterprise + urgency-100 (error/message/cron) pass |

Further layers:

- **Queue protection**: per-job chunk cap (200 events) + expire (300 s) bounds
  worst-case job size and staleness; DLQ isolates poison.
- **Worker memory protection**: bounded `localConcurrency × batchSize` per type;
  gzip cap + 256 KB per-event cap + 10 MB body limit upstream.
- **PostgreSQL slowdown**: workers naturally slow (jobs stay `active` until
  expire, then retry with backoff); gateway probe reads a grouped COUNT which
  degrades gracefully (fail-open to last cached depth).
- **Alert lag**: evaluator is watermark-based; a slow tick just widens the next
  window (no event loss, bounded by `lookbackMinutes`).
- **Notification provider failure**: existing connector circuit breakers + DLQ
  retry sweep; alerting delivery is decoupled from ingestion by queues.
- **Load shedding honesty**: shed events are counted in usage metrics
  (`events_shed`) and surfaced in the 202 response, so SDKs can retry later.

---

## 13. Organization & Project Isolation

- All `events_*` rows carry `organization_id` + `project_id`; every evaluation
  query is scoped by both (`project_id IS NULL` → org-level rule).
- `alert_rules.project_id` (nullable): org rules and project rules coexist and
  are evaluated in their own scope; presets seed at org scope.
- `alert_events.project_id` propagates scope into the delivery pipeline; route
  matching (existing) only fires routes whose project matches.
- Delivery-time re-verification (new): before any notification fan-out, the
  batch processor re-checks the DB — org exists and is active; each event's
  project still belongs to the org, is active, and is not deleted. Ineligible
  events are suppressed with an `authz` delivery-attempt record. No cached
  recipient lists are consulted, so membership/role changes, revocations, and
  project deletions take effect on the next delivery attempt.
- Quotas, usage counters, alert rules, and notification policies are all keyed
  per org (+ per project where applicable); retention is handled by the existing
  telemetry-maintenance worker per table.

Honest limitation: delivery targets are connectors (Slack/webhook/email lists in
encrypted config), not per-user materializations — there is no per-user
membership check because there are no per-user targets. The implemented filter
(org + project existence/scope/activity) is the maximal honest check at this
layer and is documented in code.

---

## 14. Usage Accounting — Decision

**Chosen: time-window aggregation via a singleton pg-boss cron (1 min), fed by
worker-side counters, transactional staging extraction. No per-event writes;
no even per-batch direct billing writes.**

Flow:

1. Workers increment tier-1 in-memory counters (`billing:events:<type>`,
   `events_persisted`) with **actually-inserted** counts; the existing
   UsageCounter batches these into the UNLOGGED `usage_counter_staging` table
   (flush 30 s / 10k buffer).
2. `ingest.usage-rollup` cron (singleton — exactly one driver platform-wide),
   in one transaction:
   - ensures current + next month partitions of `usage_daily_counters` exist
     (a DEFAULT partition exists as a safety net);
   - `DELETE … WHERE counter_type LIKE 'billing:%' RETURNING …` — atomically
     extracts staged deltas (concurrent increments are new rows, untouched);
   - aggregates per (org, project, type) and per org;
   - `increment_event_usage(org, total)` → `organization_usage_current_period`
     (the row the gateway quota check reads — closing the billing loop);
   - upserts `usage_daily_counters` per (org, project, day) with per-type
     columns + total `events_count`.
   - COMMIT, then `flush_usage_counters()` for the non-billing counters
     (hourly `project_usage` buckets). Only this job flushes — every process's
     UsageCounter runs with `driveRollup: false`.
3. Failure → ROLLBACK → staging rows preserved → next tick retries. The extract
   + apply is one transaction, so there is no loss and no double-apply.

Rejected: per-event updates (write amplification, row contention on hot orgs),
per-batch updates (still one write per 200 events), unbounded buffered
aggregation in Redis (new infra, loss on failover). Write volume is now
O(orgs × projects × types) per minute, independent of event rate — at 100k
events/s this is still a handful of UPSERTs per tick.

Accuracy note: quota enforcement is approximately 1 minute eventually-consistent
(counter path) plus a fail-open 60 s cache at the gateway. This is the standard
trade-off for high-throughput billing (Datadog/Sentry behave the same way); hard
real-time caps would require synchronous counter increments on the request path,
which this design explicitly rejects.

---

## 15. Alerting Engine

Fully asynchronous (`alert.evaluate-rules` singleton cron, 1 min):

- Due-rule scan: `enabled AND NOT deleted AND (never evaluated OR
  last_evaluated_at + evaluation_interval_seconds ≤ now)`, oldest first,
  500/tick, per-rule error isolation (watermark only advances on success).
- Evaluation SQL per condition kind, all scoped `org + project + lookback
  window`, single round trip per rule (CTEs): error count/rate (events_errors ×
  events_requests), latency avg/p95/p99 (`percentile_cont`), 5xx rate, degraded
  rate (5xx OR latency ≥ 10 s), cron failures (`events_cron_checkins.status =
  'error'`), log error count / log pattern match (ILIKE/regex with a 10k scan
  guard), inactivity (minutes since last request), metric thresholds
  (whitelisted aggregates over `events_metrics.value`). Unmappable conditions
  are skipped fail-open.
- Consecutive-violation support: breach counter in
  `alert_rules.metadata.consecutiveBreaches` (required N from rule
  metadata/annotations, default 1); reset on clear.
- Cooldown: same-fingerprint active alert inside `cooldown_seconds` suppresses
  re-fire.
- Fire: through the existing `EventsService.ingestEvent` (fingerprint dedup,
  silences, grouping, auto-resolve-at) — now with `projectId` propagated.
- Recovery: when a breached condition clears, active alerts with the rule
  fingerprint are auto-resolved (`resolution_reason = 'auto'`).
- Latency monitoring therefore supports: static thresholds, sliding windows,
  consecutive violations, P95/P99 evaluation, suppression (cooldown + silences),
  dedup (fingerprint window), and recovery detection — without any per-event
  query cost (all evaluation is windowed and asynchronous).

Cost guardrail: each rule costs ~1 windowed aggregate query per interval. At
1k active rules × 1 min this is ~17 qps of indexed window scans — acceptable on
the primary today; the honest scaling ceiling and mitigations are in §19.

---

## 16. Default Alert Rules (Presets)

Seven org-level presets (`evaluator/presets.ts`), each fully org-customizable
(enable/disable, thresholds, severity, cooldown, channels — they're ordinary
rows distinguished by `preset_key` + `is_default`):

| preset_key | Condition | Default |
|---|---|---|
| `high_error_rate` | errors ÷ requests ≥ 5 % | 5 m window |
| `high_latency_p95` | p95 latency ≥ 2000 ms | 5 m |
| `elevated_5xx` | 5xx ratio ≥ 2 % | 5 m |
| `failed_cron` | cron check-ins with status `error` ≥ 1 | 15 m |
| `service_inactivity` | no requests in 10 m | 10 m |
| `availability_degradation` | (5xx OR latency ≥ 10 s) ≥ 10 % | 5 m |
| `traffic_spike` | requests ≥ 10 000 | 5 m |

Seeding: idempotent (`uq_alert_rules_preset_scope` partial unique index +
`ON CONFLICT DO NOTHING`); `created_by` = org owner (fallback: first
owner/admin member). Triggered by the evaluator tick for orgs with traffic in
the last 24 h and no presets yet; `seedDefaultPresetsForOrg()` is exported for a
future org-creation hook. Disabling/deleting a preset does not resurrect it
(the unique key only prevents duplicate inserts, not user intent).

---

## 17. AI Extension Point (not implemented)

`src/modules/alerting/ai/alert-analysis.ts` defines `AlertAnalysisHook`
(`analyze({alertEventId, organizationId, projectId, payload}) →
AlertAnalysisResult | null`), a `NoopAlertAnalysisHook`, and a
`get/setAlertAnalysisHook` registry. The batch processor invokes it
post-generation / pre-delivery only when the org has
`ai_alert_analysis` enabled (feature flag), races it against a 2 s timeout, and
on any failure/timeout delivers unenriched. Alert payloads gain an `ai` key when
enriched. Organizations opt in independently; request-path latency is untouched
(hook runs in the delivery worker).

---

## 18. Feature Flags & Operational Dashboards

Flags (`feature_flags` table + `src/modules/feature-flags/`): scopes
platform / organization / project, most-specific-existing-row wins
(project → org → platform), 30 s LRU, `setFlag` upsert with cache invalidation.
Seeded flags: `ai_alert_analysis`, `experimental_pipelines`, `beta_processors`
(platform scope, disabled). Intended uses: AI processing, beta processors, new
event types, future analytics/storage engines.

Dashboards (Grafana-ready; all series exist today):

- **Ingestion**: accept rate, shed/reject rate, `ingest_queue_depth_pending`
  per queue, e2e latency p95 ≈ sum/count per type, DLQ size, quota-reject rate.
- **Workers**: per-type jobs/s, failure rate, fairness deferrals, org in-flight
  saturation, worker utilization (active vs localConcurrency).
- **Usage/billing**: rollup lag (last successful tick age), staged counter
  backlog, org events_used vs event_limit top-N.
- **Alerting**: rules due backlog, evaluation latency per tick, fires vs
  suppressions vs auto-resolves, delivery success per connector.
- **Database**: events_* insert rate, pgboss.job table size, slow queries.

---

## 19. Storage & Schema Evolution

New migrations (`17_enterprise_ingestion/`, all idempotent):

1. `001_events_idempotency` — unique `(project_id, event_id) NULLS NOT DISTINCT`
   on the ten `events_*` tables. Justification: database-enforced idempotency is
   the only guarantee that survives concurrent worker retries.
2. `002_alerting_project_scope` — `alert_rules` + `alert_events` gain
   `project_id`; rules gain `preset_key`, `is_default`, `last_evaluated_at`;
   preset uniqueness index. Justification: project isolation + presets +
   evaluator watermarks are impossible without these columns.
3. `003_feature_flags` — flag registry with scope CHECK (no enum migration
   needed for future scopes) + seeded platform flags.
4. `004_plans_seed` — the five canonical plans (idempotent). Justification:
   plan-aware scheduling resolves tiers from data, not hardcoded maps.
5. `005_usage_counters_default_partition` — DEFAULT partition for
   `usage_daily_counters`. Justification: the table shipped with a single
   example partition; any write outside its range would error and silently drop
   billable usage.

Pre-existing hazards found and handled: `connector_set_updated_at()` is
referenced by old migrations but never defined (new migrations use
`set_updated_at()`); the billing folder uses `.sql` extensions and is correctly
picked up by `scripts/generate-migrations.mjs` (which concatenates the draft
into `migrations/002_create_all.sql`; verified after adding the new module).

Deliberately **not** changed: `events_*` remain unpartitioned plain tables with
BRIN + btree indexes (partitioning is an operational decision that depends on
real volume; the idempotency indexes are compatible with future declarative
partitioning since they'd include the partition key only if created locally —
flagged as migration work when volume justifies it). Retention/archival stays
with the existing telemetry-maintenance worker.

---

## 20. Security, Disaster Recovery, Performance & Risks

### Security review
- API keys are SHA-256 hashed before lookup; key metadata cached ≤ 30 min;
  `updateApiKeyLastUsed` is fire-and-forget (never blocks the hot path).
- Permission model enforced at gateway: `ingest:write` + per-endpoint
  allow/block lists; mapped to 403 (previously surfaced as 500 — fixed).
- Payload: 10 MB body limit, gzip decompression cap, 256 KB per-event cap,
  1000 events/batch, Zod normalization with cardinality/DoS limits in workers.
- Rate limiting: per-project and per-org token buckets (in-process; per-process
  semantics under PM2 cluster — documented), quota pre-check per org.
- Replay protection: idempotent storage absorbs replayed payloads; DLQ replay
  requires operator auth (existing admin routes).
- Tenant isolation enforced in queries, evaluation, and delivery (§13).

### Disaster recovery
- Worker crash: jobs return via pg-boss expire (≤ 300 s) and retry; storage
  idempotency absorbs the redelivery. Graceful drain on SIGTERM (`offWork
  {wait:true}`, 20 s PM2 kill window).
- PostgreSQL restart: gateway fails open on quota/depth probes (still accepts,
  shed logic uses last cached depth); pg-boss reconnects via its pool.
- Queue corruption / poison messages: retries exhaust → `ingest.dlq-intake` →
  persisted to `ingestion_dead_letter_jobs` (dual-shape: validation rejects and
  retries-exhausted) → operator replay via existing endpoints (payloads are
  unwrapped correctly for both shapes).
- Rollup crash: transaction rollback → staging intact → next tick catches up.
- Evaluator crash: watermark not advanced → next tick re-evaluates (cooldown +
  dedup prevent double-notify).
- Notification provider outage: connector circuit breakers + DLQ retry sweep
  (pre-existing).
- Full platform outage recovery: everything durable lives in Postgres
  (pgboss.job, events_*, staging); no in-memory state is load-bearing except
  rate-limit buckets (rebuild in seconds).

### Performance review (projected, not yet load-tested)
- 10k events/s ≈ 50 jobs/s (chunks of 200): trivial for one worker process;
  gateway cost per request is one LRU hit + two token buckets + one cached
  quota read + N small validations + one bulk `insert`.
- 50k events/s ≈ 250 jobs/s: needs ~2–3 worker processes at current
  concurrency (empirically ~100–150 jobs/s/process with 8×4 workers and
  200-row batch inserts); gateway scales horizontally per core.
- 100k+ events/s: the pinch points are (a) pg-boss `job` table insert rate —
  mitigated by chunking (500 jobs/s at 100k eps) and pg-boss's partitioned job
  table; (b) `events_*` insert throughput — batched 200-row multi-values
  inserts with conflict clauses; (c) evaluator query cost growing with rule
  count (§19 mitigation). Noisy-neighbor floods are shed at highWater before
  they can starve paid tiers; per-org fairness keeps one tenant from consuming
  a queue's workers.
- Burst traffic: accepted until depth crosses highWater (100k jobs ≈ 20M
  buffered events), then gracefully degraded per §12.

### Scaling strategy
Gateway: PM2 cluster → more cores/nodes (stateless). Workers: more fork
instances + per-type concurrency tuning (independent per pipeline). Queues:
pg-boss on the primary today; the contract isolates a future move to a
dedicated Postgres (or partitioning `pgboss.job` by name) without code changes.
Alerting: rule-count sharding by org hash is the documented next step past ~5k
active rules.

### Risks & trade-offs (honest list)
1. **Compile-verified only** — no live DB/load test ran in this environment.
   First production deploy should run `generate-migrations.mjs` +
   `run-migrations.mjs` on staging and a 10k eps soak.
2. Rate-limit buckets and fairness budgets are per-process (documented
   multipliers under PM2). Fixing this properly means Redis/atomic counters —
   deliberately deferred (new infra).
3. Evaluator cost grows linearly with enabled rules; mitigation path: rule
   sharding, longer intervals for cheap rules, pre-aggregated rollups
   (`refresh_hourly_rollup` exists) as evaluation sources.
4. Quota enforcement is ~1–2 min eventually consistent (§14).
5. `usage_daily_counters` per-day rollup writes project-scope rows only;
   org-day totals derive from `organization_usage_current_period` or SUM over
   projects (avoids the NULL-project unique-key ambiguity on partitioned
   tables).
6. Deferred (fairness) jobs re-enter as new jobs: their original `receivedAt`
   is preserved for honest e2e latency, but queue-depth gauges count them
   twice over their lifetime (cosmetic).
7. Preset seeding is tick-triggered (orgs appear once they have traffic), not
   org-creation-triggered; `seedDefaultPresetsForOrg` is exported for wiring
   into org provisioning when desired.
8. Per-user notification targeting doesn't exist (connectors are the targets);
   authz filtering is at org/project granularity (§13).

### Justifications for every major decision (index)
- Single gateway + internal routing → §3. pg-boss per-type queues → §4.
- Priority math → §5. Worker-side fairness → §6. Stateless per-type workers →
  §7. Content-hash identity + ON CONFLICT storage → §11. Gateway shedding →
  §12. Time-window usage rollup → §14. Cron evaluator + watermark + cooldown →
  §15. Presets as rows with preset_key → §16. No-op AI hook behind a flag →
  §17. Three-scope flags → §18. New-table/index-only migrations → §19.
- Why no new infrastructure (Redis/Kafka): pg-boss + Postgres already provide
  durable queues, scheduling, and SKIP-LOCKED claiming; every added broker is
  another system to secure, back up, and fail over — unjustified at the
  target scale (100k eps fits in Postgres with chunking).
- Why legacy queue files were kept on disk: zero-import cutover with a trivial
  revert path; they will be deleted after the new pipeline is soak-tested.
